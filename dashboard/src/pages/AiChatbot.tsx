import { useState, useEffect } from 'react';
import { Bot, Sparkles, Save, Send, Key, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { aiBotApi, type AiBotConfigView, type Session } from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import './AiChatbot.css';

const PRESET_PROMPTS: Record<string, string> = {
  general: `You are an intelligent, friendly WhatsApp Business Assistant.
- Respond in the user's language (Gujarati, Hindi, or English).
- Be polite, concise, and helpful.
- Keep formatting clean with emojis and bullet points.`,
  gujarati_business: `તમે એક વિનમ્ર અને વ્યવસાયિક WhatsApp સહાયક (Business Assistant) છો.
- ગ્રાહકના દરેક પ્રશ્નનો સ્પષ્ટ અને સચોટ જવાબ આપો.
- જો ગ્રાહક ગુજરાતીમાં લખે તો શુદ્ધ અને આદરપૂર્વક ગુજરાતીમાં જવાબ આપો.
- જો કોઈ વિગત નોલેજ બેઝમાં ન હોય, તો આપણી ટીમના પ્રતિનિધિનો સંપર્ક કરવા વિનંતી કરો.`,
  ecommerce: `You are an expert sales and customer support assistant on WhatsApp.
- Help customers with product inquiries, prices, and orders.
- Always be encouraging, polite, and prompt.
- Suggest contacting support if an issue requires manual assistance.`,
};

export function AiChatbot() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [config, setConfig] = useState<AiBotConfigView | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-1.5-flash');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(10);

  // Test Simulator State
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<{ response: string; error?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Set default selected session
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Load config when session changes
  useEffect(() => {
    if (!selectedSessionId) return;

    let isMounted = true;
    setIsLoadingConfig(true);
    setTestResult(null);

    aiBotApi
      .getConfig(selectedSessionId)
      .then(data => {
        if (!isMounted) return;
        setConfig(data);
        setEnabled(data.enabled);
        setProvider(data.provider || 'gemini');
        setApiKey(data.apiKey || '');
        setModel(data.model || (data.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'));
        setSystemPrompt(data.systemPrompt || PRESET_PROMPTS.general);
        setKnowledgeBase(data.knowledgeBase || '');
        setCooldownSeconds(data.cooldownSeconds ?? 10);
      })
      .catch(err => {
        toast.error('Failed to load AI config', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (isMounted) setIsLoadingConfig(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedSessionId, toast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;

    setIsSaving(true);
    try {
      const updated = await aiBotApi.updateConfig(selectedSessionId, {
        enabled,
        provider,
        apiKey: apiKey.trim(),
        model,
        systemPrompt,
        knowledgeBase,
        cooldownSeconds: Number(cooldownSeconds),
      });

      setConfig(updated);
      setApiKey(updated.apiKey);
      toast.success('AI Chatbot settings saved successfully!');
    } catch (err) {
      toast.error('Failed to save settings', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunTest = async () => {
    if (!selectedSessionId || !testMessage.trim()) return;

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await aiBotApi.testPrompt(selectedSessionId, testMessage.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({
        response: '',
        error: err instanceof Error ? err.message : 'Error testing AI prompt',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const applyPreset = (key: string) => {
    if (PRESET_PROMPTS[key]) {
      setSystemPrompt(PRESET_PROMPTS[key]);
      toast.info('Preset prompt applied!');
    }
  };


  return (
    <div className="ai-chatbot-page">
      <PageHeader
        title="AI Chatbot (Auto-Reply)"
        subtitle="Intelligent automated responses powered by Google Gemini or OpenAI"
      />

      <div className="ai-chatbot-session-bar">
        <label htmlFor="session-select">WhatsApp Session:</label>
        {sessionsLoading ? (
          <Loader2 className="animate-spin" size={18} />
        ) : (
          <select
            id="session-select"
            value={selectedSessionId}
            onChange={e => setSelectedSessionId(e.target.value)}
            className="session-select"
          >
            {sessions.map((s: Session) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoadingConfig ? (
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <span>Loading AI configuration...</span>
        </div>
      ) : (
        <div className="ai-chatbot-grid">
          {/* Main Config Form */}
          <form className="ai-config-card" onSubmit={handleSave}>
            <div className="card-header-toggle">
              <div className="toggle-title">
                <Bot className="icon-bot" size={24} />
                <div>
                  <h3>AI Auto-Reply Engine</h3>
                  <p>When enabled, AI automatically answers customer inquiries on WhatsApp.</p>
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            <div className="form-group-row">
              <div className="form-group">
                <label htmlFor="ai-provider-select">AI Provider</label>
                <select
                  id="ai-provider-select"
                  value={provider}
                  onChange={e => {
                    const newProvider = e.target.value as 'gemini' | 'openai';
                    setProvider(newProvider);
                    setModel(newProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
                  }}
                >
                  <option value="gemini">Google Gemini (Recommended)</option>
                  <option value="openai">OpenAI (ChatGPT)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="ai-model-select">Model</label>
                {provider === 'gemini' ? (
                  <select id="ai-model-select" value={model} onChange={e => setModel(e.target.value)}>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast & Cost-Effective)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Advanced Reasoning)</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  </select>
                ) : (
                  <select id="ai-model-select" value={model} onChange={e => setModel(e.target.value)}>
                    <option value="gpt-4o-mini">GPT-4o Mini (Fast)</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  </select>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>
                <Key size={14} /> API Key {config?.hasApiKey && <span className="badge-saved">Saved</span>}
              </label>
              <input
                type="password"
                placeholder={config?.hasApiKey ? config.apiKey : 'Enter your API Key...'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
              <small className="form-hint">
                {provider === 'gemini'
                  ? 'Get your free key from Google AI Studio (aistudio.google.com)'
                  : 'Get your key from platform.openai.com/api-keys'}
              </small>
            </div>

            <div className="form-group">
              <div className="label-with-presets">
                <label>
                  <Sparkles size={14} /> System Prompt (Instructions)
                </label>
                <div className="preset-buttons">
                  <span>Presets:</span>
                  <button type="button" onClick={() => applyPreset('general')}>General</button>
                  <button type="button" onClick={() => applyPreset('gujarati_business')}>ગુજરાતી બિઝનેસ</button>
                  <button type="button" onClick={() => applyPreset('ecommerce')}>E-Commerce</button>
                </div>
              </div>
              <textarea
                rows={5}
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="Give instructions to the bot on tone, language, and behavior..."
              />
            </div>

            <div className="form-group">
              <label>
                <FileText size={14} /> Business Knowledge Base & FAQs
              </label>
              <textarea
                rows={6}
                value={knowledgeBase}
                onChange={e => setKnowledgeBase(e.target.value)}
                placeholder="Paste your business details, FAQs, pricing, product list, opening hours, address here..."
              />
              <small className="form-hint">
                The AI will use these facts to answer customer questions accurately without hallucinating.
              </small>
            </div>

            <button type="submit" className="btn-save" disabled={isSaving}>
              {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save AI Settings
            </button>
          </form>

          {/* Test & Simulation Panel */}
          <div className="ai-test-card">
            <div className="card-header">
              <Sparkles size={20} className="icon-sparkle" />
              <div>
                <h3>Test AI Simulator</h3>
                <p>Test how the bot responds to customer questions before activating.</p>
              </div>
            </div>

            <div className="test-body">
              <div className="form-group">
                <label>Customer Message</label>
                <div className="test-input-row">
                  <input
                    type="text"
                    value={testMessage}
                    onChange={e => setTestMessage(e.target.value)}
                    placeholder="દા.ત. તમારો શોપ ટાઈમિંગ શું છે? / What are your prices?"
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleRunTest())}
                  />
                  <button
                    type="button"
                    className="btn-send-test"
                    onClick={handleRunTest}
                    disabled={isTesting || !testMessage.trim()}
                  >
                    {isTesting ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="test-response-box">
                  {testResult.error ? (
                    <div className="test-error">
                      <AlertCircle size={18} />
                      <span>{testResult.error}</span>
                    </div>
                  ) : (
                    <div className="test-success">
                      <div className="test-reply-header">
                        <CheckCircle2 size={16} color="#10b981" />
                        <span>AI Response:</span>
                      </div>
                      <div className="test-reply-content">{testResult.response}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AiChatbot;
