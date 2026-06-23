import { useState } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { Link as RouterLink } from 'react-router-dom';

const SKILL_URL = 'https://modelhub.riscale.eu/SKILL.md';

interface AgentSkillBoxProps {
  /** "explore" omits the contribute/token guidance; "contribute" includes it. */
  mode?: 'explore' | 'contribute';
  /** Default open state — defaults to false (collapsed). */
  defaultOpen?: boolean;
  /** Tailwind classes for the outer container. */
  className?: string;
}

/**
 * Collapsible info panel that helps users hand the Model Hub off to an
 * AI agent: shows the public SKILL.md URL, a ready-to-copy instruction
 * snippet, and (in `contribute` mode) an inline "Generate API key" flow.
 *
 * The actual skill instructions live at /SKILL.md (public/SKILL.md in
 * this repo).
 */
export default function AgentSkillBox({
  mode = 'explore',
  defaultOpen = false,
  className = '',
}: AgentSkillBoxProps) {
  const { server, user, isLoggedIn } = useHyphaStore();
  const [open, setOpen] = useState(defaultOpen);
  const [token, setToken] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const expiries: { label: string; seconds: number }[] = [
    { label: '1 hour', seconds: 3600 },
    { label: '24 hours', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: '30 days', seconds: 2592000 },
  ];

  const generate = async (expiresIn: number, label: string) => {
    if (!server) return;
    setGenerating(true);
    try {
      const t = await server.generateToken({ expires_in: expiresIn });
      setToken(t);
      setTokenExpiry(label);
    } catch (e: any) {
      alert(`Could not generate token: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  };

  const exploreSnippet =
    `Please use this Agent Skill to interact with the RI-SCALE AI Model Hub:\n\n` +
    `  ${SKILL_URL}\n\n` +
    `Then help me search and browse the model catalogue. No authentication is needed for read-only operations.`;

  const contributeSnippet = (tok: string | null) =>
    `Please use this Agent Skill to interact with the RI-SCALE AI Model Hub:\n\n` +
    `  ${SKILL_URL}\n\n` +
    `Operate on my behalf using this Hypha API token:\n\n` +
    `  ${tok ?? '<generate one in the box below and paste it here>'}\n\n` +
    `Keep the token private — do not echo it back in chat or commit it.`;

  const snippet = mode === 'contribute' ? contributeSnippet(token) : exploreSnippet;

  return (
    <div
      className={`border border-gray-200 rounded-lg bg-white overflow-hidden ${className}`}
    >
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold"
            style={{ background: 'rgba(243, 146, 0, 0.12)', color: '#d97f00' }}
            aria-hidden
          >
            ✦
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              Use this with your AI agent
            </div>
            <div className="text-xs text-gray-500 truncate">
              {mode === 'contribute'
                ? 'Have an AI agent (Claude, etc.) create, upload, and publish models on your behalf'
                : 'Have an AI agent (Claude, etc.) search and browse the catalogue for you'}
            </div>
          </div>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#6b7280" strokeWidth="2"
          style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {/* SKILL.md URL with copy */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              ▸ Agent Skill URL
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2">
              <code className="flex-1 text-xs font-mono text-gray-800 truncate">
                {SKILL_URL}
              </code>
              <button
                onClick={() => copy(SKILL_URL, 'url')}
                className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-orange-500 hover:text-orange-600 transition-colors"
              >
                {copied === 'url' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Follows the{' '}
              <a
                href="https://agentskills.io/specification"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-orange-600"
              >
                AgentSkills.io
              </a>{' '}
              specification — pasteable into Claude, Cursor, or any skill-aware AI agent.
            </p>
          </div>

          {/* Contribute mode: token generation */}
          {mode === 'contribute' && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                ▸ API Key
              </div>
              {!isLoggedIn ? (
                <div className="text-sm bg-orange-50 border border-orange-200 rounded p-3">
                  <p className="text-orange-900 mb-2">
                    Uploading models requires authentication.
                  </p>
                  <RouterLink
                    to="/upload"
                    className="text-orange-700 underline hover:text-orange-900"
                  >
                    Log in to generate a key
                  </RouterLink>
                </div>
              ) : token ? (
                <>
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2 mb-1">
                    <code className="flex-1 text-xs font-mono text-gray-800 truncate" title={token}>
                      {token}
                    </code>
                    <button
                      onClick={() => copy(token, 'token')}
                      className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-orange-500 hover:text-orange-600 transition-colors"
                    >
                      {copied === 'token' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Expires in {tokenExpiry}. Treat this as a secret.
                    Need a different lifetime?{' '}
                    <button
                      onClick={() => { setToken(null); setTokenExpiry(''); }}
                      className="underline hover:text-orange-600"
                    >
                      Generate another
                    </button>
                    .
                  </p>
                </>
              ) : (
                <div>
                  <p className="text-xs text-gray-600 mb-2">
                    Signed in as <strong>{user?.email}</strong>. Pick an expiry:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {expiries.map((e) => (
                      <button
                        key={e.label}
                        onClick={() => generate(e.seconds, e.label)}
                        disabled={generating}
                        className="text-xs px-3 py-1.5 rounded-full border border-gray-300 hover:border-orange-500 hover:text-orange-600 transition-colors disabled:opacity-50"
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Copy-paste snippet */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              ▸ Copy &amp; paste this to your agent
            </div>
            <div className="relative bg-gray-900 rounded p-3">
              <pre className="text-xs font-mono text-gray-100 whitespace-pre-wrap break-words pr-12 m-0">
                {snippet}
              </pre>
              <button
                onClick={() => copy(snippet, 'snippet')}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
              >
                {copied === 'snippet' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
