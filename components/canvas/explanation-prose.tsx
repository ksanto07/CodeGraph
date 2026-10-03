import { explanationProse, repositoryPathParts, type ProseInline } from '@/lib/ai/prose';

interface ProseProps { body: string; paths: readonly string[]; selectFile: (id: string) => void }
export function ExplanationProse({ body, paths, selectFile }: ProseProps) {
  const linked = (text: string) => repositoryPathParts(text, paths).map((part, index) => {
    const path = part.path;
    return path ? <button key={index} className="explanation-path" onClick={() => selectFile(path)}>{part.text}</button> : part.text;
  });
  const render = (tokens: ProseInline[]): React.ReactNode => tokens.map((token, index) => token.kind === 'bold' ?
    <strong key={index}>{render(token.children)}</strong> : token.kind === 'code' ? <code key={index}>{linked(token.text)}</code> : <span key={index}>{linked(token.text)}</span>);
  return <div className="explanation-prose">{explanationProse(body).map((block, index) => block.kind === 'paragraph' ?
    <p key={index}>{render(block.children)}</p> : <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{render(item)}</li>)}</ul>)}</div>;
}
