import { BaseChatModel, type BaseChatModelCallOptions, type BindToolsInput } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ResponsesInput, ResponsesReasoning, ResponsesRoundTransport, ResponsesTool } from '../lib/ai/client.ts';

export interface CartographChatModelOptions { model: string; round: ResponsesRoundTransport }
interface CallOptions extends BaseChatModelCallOptions { tools?: ResponsesTool[] }

function reasoning(input: unknown): ResponsesReasoning[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('Invalid reasoning replay.');
  return input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'reasoning' || !('id' in item) || typeof item.id !== 'string' || !('summary' in item) || !Array.isArray(item.summary)) throw new Error('Invalid reasoning replay.');
    const summary = item.summary.map((part: unknown) => {
      if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'summary_text' || !('text' in part) || typeof part.text !== 'string') throw new Error('Invalid reasoning summary.');
      return { type: 'summary_text' as const, text: part.text };
    });
    const encrypted = 'encrypted_content' in item ? item.encrypted_content : undefined;
    if (encrypted !== undefined && encrypted !== null && typeof encrypted !== 'string') throw new Error('Invalid reasoning payload.');
    return { type: 'reasoning', id: item.id, summary, encrypted_content: encrypted };
  });
}

function content(message: BaseMessage): string {
  if (typeof message.content !== 'string') throw new Error('Cartograph accepts text messages only.');
  return message.content;
}

export class CartographChatModel extends BaseChatModel<CallOptions> {
  readonly modelName: string;
  readonly model_name: string;
  readonly #round: ResponsesRoundTransport;
  readonly #tools: ResponsesTool[];
  lc_serializable = false;
  constructor(options: CartographChatModelOptions, tools: ResponsesTool[] = []) {
    super({});
    this.modelName = options.model;
    this.model_name = `cartograph:${options.model}`;
    this.#round = options.round;
    this.#tools = tools;
  }
  _llmType(): string { return 'cartograph-chatgpt'; }
  get lc_serializable_keys(): string[] { return ['modelName']; }
  bindTools(tools: BindToolsInput[], kwargs?: Partial<CallOptions>) {
    const converted = tools.map(tool => {
      const definition = convertToOpenAITool(tool);
      if (definition.type !== 'function' || !definition.function.parameters) throw new Error('Only function tools are supported.');
      return { name: definition.function.name, description: definition.function.description ?? '', parameters: definition.function.parameters };
    });
    if (kwargs?.tool_choice && kwargs.tool_choice !== 'auto' && kwargs.tool_choice !== 'required') throw new Error('Only auto or required tool selection is supported.');
    return new CartographChatModel({ model: this.modelName, round: this.#round }, converted);
  }
  async *_streamResponseChunks(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): AsyncGenerator<ChatGenerationChunk> {
    const input: ResponsesInput[] = [];
    const instructions: string[] = [];
    const calls = new Set<string>();
    const callNames = new Map<string, string>();
    const available = new Set((options.tools ?? this.#tools).map(tool => tool.name));
    let hasCurrentEvidence = false;
    for (const message of messages) {
      if (message.type === 'system') { instructions.push(content(message)); continue; }
      if (message.type === 'human') { hasCurrentEvidence = false; callNames.clear(); input.push({ type: 'message', role: 'user', content: content(message) }); continue; }
      if (message.type === 'ai') {
        input.push(...reasoning(message.additional_kwargs.responses_reasoning));
        const body = content(message);
        if (body) input.push({ type: 'message', role: 'assistant', content: body });
        if (!AIMessage.isInstance(message)) throw new Error('Invalid assistant message.');
        for (const call of message.tool_calls ?? []) {
          if (!call.id || calls.has(call.id)) throw new Error('Missing or duplicate function call ID.');
          calls.add(call.id);
          callNames.set(call.id, call.name);
          input.push({ type: 'function_call', callId: call.id, name: call.name, arguments: JSON.stringify(call.args) });
        }
        continue;
      }
      if (message.type === 'tool' && 'tool_call_id' in message && typeof message.tool_call_id === 'string') {
        if (!calls.has(message.tool_call_id)) throw new Error('Tool output lacks its original function call.');
        if (available.has(callNames.get(message.tool_call_id) ?? '') && (!('status' in message) || message.status !== 'error')) hasCurrentEvidence = true;
        input.push({ type: 'function_output', callId: message.tool_call_id, output: content(message) });
        continue;
      }
      throw new Error('Unsupported message type.');
    }
    if (options.tool_choice && options.tool_choice !== 'auto' && options.tool_choice !== 'required') throw new Error('Only auto or required tool selection is supported.');
    const requiresTool = available.size > 0 && !hasCurrentEvidence;
    let index = 0;
    let completed = false;
    const seen = new Set<string>();
    for await (const event of this.#round({ model: this.modelName, instructions: instructions.join('\n\n'), input, tools: options.tools ?? this.#tools, toolChoice: requiresTool ? 'required' : 'auto' }, options.signal)) {
      options.signal?.throwIfAborted();
      if (event.type === 'completed') completed = true;
      if (event.type === 'reasoning') yield new ChatGenerationChunk({ text: '', message: new AIMessageChunk({ content: '', additional_kwargs: { responses_reasoning: [event.item] } }) });
      if (event.type === 'text_delta') {
        const chunk = new ChatGenerationChunk({ text: event.text, message: new AIMessageChunk({ content: event.text }) });
        yield chunk;
        await runManager?.handleLLMNewToken(event.text);
      }
      if (event.type === 'tool_call') {
        if (!event.callId || seen.has(event.callId)) throw new Error('Missing or duplicate response function call ID.');
        seen.add(event.callId);
        const args: unknown = JSON.parse(event.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Function arguments must be an object.');
        yield new ChatGenerationChunk({ text: '', message: new AIMessageChunk({ content: '', tool_call_chunks: [
          { name: event.name, id: event.callId, args: event.arguments, index: index++, type: 'tool_call_chunk' },
        ] }) });
      }
    }
    if (requiresTool && !seen.size) throw new Error('The answer requires a graph lookup for this question.');
    if (!completed) throw new Error('ChatGPT stream ended without completion.');
  }
  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
    let generation: ChatGenerationChunk | undefined;
    for await (const chunk of this._streamResponseChunks(messages, options, runManager)) generation = generation ? generation.concat(chunk) : chunk;
    if (!generation) throw new Error('ChatGPT returned an empty response.');
    return { generations: [generation] };
  }
}
