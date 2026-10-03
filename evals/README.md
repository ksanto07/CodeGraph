# Evaluation commands

Run from the repository root. Scripts load the installed Next environment loader before importing inference modules, using the same `.env*` precedence as the app. Set `NODE_ENV=production` when evaluating the production environment.

```sh
node scripts/collect-eval-dataset.ts --out /tmp/cartograph-held-out.json
node scripts/eval.ts roles --user user_ID --data /tmp/cartograph-held-out.json
node scripts/eval.ts prompts --user user_ID --data /tmp/cartograph-held-out.json
node scripts/eval.ts recent --since 2026-10-03T00:00:00Z --limit 50
```

Replace the example timestamp with the start of the traffic to inspect and `user_ID` with the Clerk user who owns the local ChatGPT connection. Provider experiments require `LANGSMITH_API_KEY`, enabled tracing, completed ChatGPT consent, and exact dated model pins present in that account's catalog. Role experiments use `CARTOGRAPH_CLASSIFICATION_MODEL`. Prompt experiments use `CARTOGRAPH_EXPLANATION_MODEL`; an optional `CARTOGRAPH_JUDGE_MODEL` can select another exact snapshot, otherwise the explanation snapshot also judges specificity. No moving model alias is accepted. Missing prerequisites fail before experiments run.

The collector downloads two immutable public archives through the application archive defenses, parses real imports, and verifies all 30 manifest file hashes and conventional roles. It hides every node annotation from model contexts. The held-out set covers eight components, eight hooks, six configs, six services, one model and one util, with no repository examples. Accuracy measures agreement with these adapter conventions; it does not establish broad semantic accuracy.

Prompt experiments compare the shipped retired `explain-v1` with current `explain-v2` over identical examples. Their path membership scores are deterministic. The specificity judge's score is a subjective model opinion. Reports include full sample counts, judge failures, measured differences only when both experiments are complete, and dashboard links returned by LangSmith.

Every application Explain call, including cache hits, checks the canonical returned prose against the exact paths in its supplied context and attempts feedback delivery inside that trace. The pane distinguishes recorded feedback, local checks with tracing disabled, and failed uploads. Merely hydrating a saved pane body does not invent an inference trace.

The recent-traffic command reads at most 100 root runs. Missing evidence remains unscored, and zero eligible traffic is not a successful live evaluation. It prints literal failure spans for manual confirmation. Quoted or inline-code paths preserve whitespace and punctuation; bare whitespace paths are separate lexical pieces. Dotted prose and slash-separated prose can count as path-shaped tokens. The checker never consults a repository-wide allowlist or changes spelling to make a token pass.
