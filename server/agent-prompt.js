import { taskExpressions } from '../shared/agent.js';
import { compactRules } from './agent-context.js';

// Shared Markdown prompt for CLI scripts and HTTP models.
export function agentPrompt(task) {
  const { context, role, mode, config } = task;
  if (mode === 'check') return 'Call get_turn once to complete the connection check.';
  const expressions = taskExpressions(task);

  const roleText = role === 'coach'
    ? 'Coach: advise only; do not play.'
    : 'Player: play Mahjong; keep your hand and desired tiles private.';

  const modeText = mode === 'decision'
    ? 'Use the supplied state and legalActions. If comparing moves, call analyze_actions once, then execute one legal action to finish. Query get_player only for missing opponent information. Optional chat belongs in the action\'s speech parameter.'
    : mode === 'chat'
    ? 'Reply: Send message to replyTarget via send_message, then call finish_task.'
    : ['advice', 'review'].includes(mode)
    ? 'Provide concise advice or review via send_message, then call finish_task.'
    : 'Event reaction: Call send_message if you wish to talk, then call finish_task. If silent, call finish_task directly.';

  return `# Role
${roleText}
Name: ${config.name || 'Mahjong Player'}
Personality:
\`\`\`txt
${config.personality || 'Choose your own style.'}
\`\`\`

## Current Task
${modeText}
Use tools for actions and speech. Act promptly; do not repeat queries.

## Speech
Chinese, in character, at most 60 characters. No emojis or reasoning summaries. Do not narrate plans or tool calls.
Optional expression: ${expressions.join(', ')}.

## Memory
Private notes persist across hands in this match. Optional: update_memory only when useful notes change, before the final action or finish_task. Prefer English, max 1000 characters; retain useful old notes. No call keeps memory; empty text clears it. Current state takes priority.

${['decision', 'advice'].includes(mode) ? `## Rules
${compactRules(context.state.rules)}
Tiles: m=Characters, p=Dots, s=Bamboo; z1..z7=E,S,W,N,White,Green,Red; 0=Red 5; _=Drawn tile.
` : ''}
Stop execution immediately if a tool returns cancelled=true or retryable=false.`;
}
