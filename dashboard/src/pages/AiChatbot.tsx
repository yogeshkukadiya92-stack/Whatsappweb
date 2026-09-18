import { useState, useEffect } from 'react';
import {
  Bot,
  Sparkles,
  Save,
  Send,
  Key,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Edit2,
  ShoppingBag,
  Headphones,
  CreditCard,
  CircleHelp,
  Sliders,
  Tag,
  Zap,
  UploadCloud,
  FileSpreadsheet,
  Eye,
  X,
  ShieldCheck,
  FileCheck,
  Copy,
  FileCode,
} from 'lucide-react';
import {
  aiBotApi,
  type AiBotConfigView,
  type AiAgentView,
  type CreateAiAgentInput,
  type Session,
} from '../services/api';
import { useSessionsQuery, useSessionChatsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import './AiChatbot.css';

export interface UploadedDocument {
  id: string;
  name: string;
  size: number;
  type: 'pdf' | 'excel' | 'word' | 'csv' | 'text';
  extractedText: string;
  charCount: number;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getDocumentType(filename: string): 'pdf' | 'excel' | 'word' | 'csv' | 'text' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'word';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv';
  return 'text';
}

function parseExistingDocuments(kb: string): { docs: UploadedDocument[]; manualNotes: string } {
  if (!kb) return { docs: [], manualNotes: '' };
  const docRegex =
    /--- DOCUMENT:\s*(.+?)(?:\s*\((.*?)\))?\s*---\n([\s\S]*?)(?=(?:--- DOCUMENT:)|(?:--- ADDITIONAL NOTES & INSTRUCTIONS ---)|$)/g;
  const docs: UploadedDocument[] = [];
  let match: RegExpExecArray | null;

  while ((match = docRegex.exec(kb)) !== null) {
    const filename = match[1].trim();
    const text = match[3].trim();
    const type = getDocumentType(filename);

    docs.push({
      id: `${filename}-${docs.length}-${Date.now()}`,
      name: filename,
      size: text.length,
      type,
      extractedText: text,
      charCount: text.length,
    });
  }

  let manualNotes = kb;
  if (docs.length > 0) {
    const notesMatch = kb.match(/--- ADDITIONAL NOTES & INSTRUCTIONS ---\n([\s\S]*)$/);
    if (notesMatch) {
      manualNotes = notesMatch[1].trim();
    } else {
      manualNotes = kb
        .replace(/--- DOCUMENT:[\s\S]*?(?=(?:--- DOCUMENT:)|(?:--- ADDITIONAL NOTES & INSTRUCTIONS ---)|$)/g, '')
        .trim();
    }
  }

  return { docs, manualNotes };
}

function compileKnowledgeBase(docs: UploadedDocument[], notes: string): string {
  const parts: string[] = [];
  if (docs.length > 0) {
    const docText = docs
      .map(d => `--- DOCUMENT: ${d.name} (${formatBytes(d.size)}) ---\n${d.extractedText.trim()}`)
      .join('\n\n');
    parts.push(docText);
  }
  if (notes.trim()) {
    if (docs.length > 0) {
      parts.push(`--- ADDITIONAL NOTES & INSTRUCTIONS ---\n${notes.trim()}`);
    } else {
      parts.push(notes.trim());
    }
  }
  return parts.join('\n\n');
}

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

// Preset Templates for Specialized Agents
type AgentRole = 'sales' | 'support' | 'billing' | 'inquiry' | 'custom';

type AgentTemplate = {
  name: string;
  role: AgentRole;
  priority: number;
  triggerKeywords: string[];
  description: string;
  systemPrompt: string;
  knowledgeBase: string;
};

const AGENT_TEMPLATES: Record<AgentRole, AgentTemplate> = {
  sales: {
    name: 'Sales & Deal Closer Bot',
    role: 'sales' as const,
    priority: 20,
    triggerKeywords: [
      'price',
      'pricing',
      'buy',
      'cost',
      'discount',
      'offer',
      'purchase',
      'catalog',
      'demo',
      'ભાવ',
      'કિંમત',
      'ખરીદવું',
      'ઓફર',
    ],
    description: 'Handles sales inquiries, recommends best packages, quotes prices, and converts leads.',
    systemPrompt: `You are an energetic, high-converting WhatsApp Sales Executive.
Goals:
1. Understand the customer's requirement quickly and recommend the ideal package/product.
2. Highlight current discounts and unique value propositions.
3. Answer questions about prices, features, and purchase options with enthusiasm.
4. Always include a polite Call to Action (e.g. "Would you like me to book your demo / generate an invoice?").
5. Respond in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Product Catalog & Pricing:
- Starter Pack: ₹999/month (Basic WhatsApp automation, up to 1,000 chats)
- Growth Pro: ₹2,499/month (Unlimited AI chatbots, bulk broadcasts, full CRM)
- Enterprise Plan: ₹4,999/month (Dedicated account manager, custom API integrations, priority support)
Current Special Offer: 15% instant discount on annual billing!`,
  },
  support: {
    name: 'Customer Support Specialist',
    role: 'support' as const,
    priority: 30,
    triggerKeywords: [
      'help',
      'issue',
      'error',
      'bug',
      'problem',
      'not working',
      'fail',
      'support',
      'complain',
      'refund',
      'મદદ',
      'તકલીફ',
      'પ્રોબ્લેમ',
    ],
    description: 'Solves user troubles, explains troubleshooting steps, and handles service complaints.',
    systemPrompt: `You are a calm, empathetic, and highly efficient Customer Support Specialist on WhatsApp.
Goals:
1. Acknowledge the user's issue with genuine empathy ("We are sorry for any inconvenience...").
2. Give crystal-clear step-by-step troubleshooting instructions.
3. If the issue requires engineer intervention or account check, ask for their Order ID / Phone number and confirm human handoff within 15 minutes.
4. Reply in the same language the customer reaches out in.`,
    knowledgeBase: `Common Support Answers:
- WhatsApp Disconnection: Go to Dashboard -> Sessions -> Scan QR again to re-sync.
- Refund Policy: Full refund within 7 days of purchase if not satisfied.
- Working Hours: Support desk is open Monday to Saturday, 9 AM to 7 PM IST.`,
  },
  billing: {
    name: 'Billing & Payment Assistant',
    role: 'billing',
    priority: 40,
    triggerKeywords: [
      'payment',
      'paid',
      'invoice',
      'bill',
      'billing',
      'receipt',
      'refund',
      'transaction',
      'failed payment',
      'UPI',
      'card',
      'ચુકવણી',
      'બિલ',
      'રિફંડ',
      'પેમેન્ટ',
    ],
    description: 'Handles payment questions, invoices, receipts, failed transactions, and refund requests.',
    systemPrompt: `You are a careful and trustworthy WhatsApp Billing & Payment Assistant.
Goals:
1. Identify whether the customer needs help with a payment, invoice, receipt, refund, or failed transaction.
2. Never ask for a card number, CVV, OTP, UPI PIN, password, or other sensitive financial credentials.
3. Ask only for safe verification details such as Order ID, Invoice ID, transaction reference, payment date, and registered phone number.
4. Explain the next step and expected resolution time clearly. Escalate disputes, duplicate charges, or unverified payments to a human billing agent.
5. Never claim that a payment or refund is complete unless that status exists in the knowledge base or supplied account data.
6. Reply in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Billing & Payment Information (replace the bracketed details):
- Accepted payment methods: [UPI / Cards / Net Banking / Cash]
- Invoice process: [How and when customers receive invoices]
- Payment confirmation time: [Expected time]
- Failed payment guidance: [Retry/wait/contact instructions]
- Refund eligibility: [Your refund policy]
- Refund processing time: [Number of business days]
- Billing support contact/hours: [Details]

Safety: Never request OTP, CVV, UPI PIN, full card number, or banking password.`,
  },
  inquiry: {
    name: 'FAQ & General Query Bot',
    role: 'inquiry',
    priority: 10,
    triggerKeywords: [
      'faq',
      'question',
      'query',
      'information',
      'details',
      'hours',
      'timing',
      'location',
      'address',
      'how',
      'what',
      'where',
      'માહિતી',
      'પ્રશ્ન',
      'સમય',
      'સરનામું',
      'ક્યાં',
    ],
    description: 'Answers frequently asked questions and general business, service, location, and policy inquiries.',
    systemPrompt: `You are a friendly and accurate WhatsApp FAQ & General Query Assistant.
Goals:
1. Understand the customer's question and answer directly using only the supplied knowledge base.
2. Keep answers short, clear, and easy to scan on WhatsApp.
3. Ask one concise follow-up question when the request is ambiguous.
4. If the answer is not available, say so honestly and offer a human handoff instead of guessing.
5. Share links, timings, addresses, or contact details exactly as written in the knowledge base.
6. Reply in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Frequently Asked Questions (replace the bracketed details):
Q: What are your business hours?
A: [Days and timings]

Q: Where are you located?
A: [Full address and map link]

Q: How can I contact your team?
A: [Phone / email / WhatsApp details]

Q: What products or services do you offer?
A: [Short list]

Q: What is your delivery/service area?
A: [Coverage details]

Q: What are your cancellation and return policies?
A: [Policy details]`,
  },
  custom: {
    name: 'Custom Purpose Bot',
    role: 'custom',
    priority: 5,
    triggerKeywords: [],
    description: '',
    systemPrompt: `You are a specialized WhatsApp Assistant.
1. Help customers only with the purpose and information defined below.
2. Be concise, polite, and accurate.
3. Do not guess when information is missing; offer a human handoff.
4. Reply in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Add the information, rules, FAQs, and escalation details this bot should use.`,
  },
};

export function AiChatbot() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const activeSessionId = selectedSessionId === 'all' ? sessions[0]?.id || '' : selectedSessionId;
  const { data: sessionChats = [] } = useSessionChatsQuery(activeSessionId, Boolean(activeSessionId));
  const [activeTab, setActiveTab] = useState<'agents' | 'settings'>('agents');
  const [config, setConfig] = useState<AiBotConfigView | null>(null);
  const [agents, setAgents] = useState<AiAgentView[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form State for Global / Default Bot
  const [enabled, setEnabled] = useState(false);
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-1.5-flash');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(10);

  // Specialized Agent Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState<{
    name: string;
    role: AgentRole;
    enabled: boolean;
    priority: number;
    triggerKeywords: string;
    audience: 'all' | 'numbers' | 'groups' | 'non_contacts' | 'selected_groups';
    targetNumbers: string;
    messageTypes: string;
    similarMessages: string;
    description: string;
    systemPrompt: string;
    knowledgeBase: string;
  }>({
    name: '',
    role: 'sales',
    enabled: true,
    priority: 10,
    triggerKeywords: '',
    audience: 'all',
    targetNumbers: '',
    messageTypes: '',
    similarMessages: '',
    description: '',
    systemPrompt: '',
    knowledgeBase: '',
  });

  // Test Simulator State
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<{
    response: string;
    error?: string;
    matchedAgent?: { name: string; role: string; id: string };
    fallbackDisabled?: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Specialized Agent Document & Knowledge Base State
  const [agentDocuments, setAgentDocuments] = useState<UploadedDocument[]>([]);
  const [customNotes, setCustomNotes] = useState('');
  const [isExtractingDoc, setIsExtractingDoc] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);
  const [activeKbTab, setActiveKbTab] = useState<'documents' | 'manual'>('documents');
  const [isDragOver, setIsDragOver] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);

  // Set default selected session to 'all'
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId('all');
    }
  }, [sessions, selectedSessionId]);

  // Load config & agents when session changes
  const loadAgents = async (sessionId: string) => {
    try {
      setIsLoadingAgents(true);
      const data = await aiBotApi.listAgents(sessionId);
      setAgents(data);
    } catch {
      // ignore empty
    } finally {
      setIsLoadingAgents(false);
    }
  };

  useEffect(() => {
    if (!selectedSessionId || sessions.length === 0) return;

    let isMounted = true;
    setIsLoadingConfig(true);
    setTestResult(null);

    const fetchSessionId = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;

    aiBotApi
      .getConfig(fetchSessionId)
      .then(data => {
        if (!isMounted) return;
        setConfig(data);
        setEnabled(data.enabled);
        setFallbackEnabled(Boolean(data.fallbackEnabled));
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

    loadAgents(fetchSessionId);

    return () => {
      isMounted = false;
    };
  }, [selectedSessionId, sessions, toast]);

  const savePayload = async (targetSession: string) => {
    return aiBotApi.updateConfig(targetSession, {
      enabled,
      fallbackEnabled,
      provider,
      apiKey: apiKey.trim(),
      model,
      systemPrompt,
      knowledgeBase,
      cooldownSeconds: Number(cooldownSeconds),
    });
  };

  const handleToggleMasterStatus = async (nextEnabled: boolean) => {
    if (!selectedSessionId || isSaving) return;

    const previousEnabled = enabled;
    setEnabled(nextEnabled);
    setIsSaving(true);

    try {
      if (selectedSessionId === 'all') {
        await aiBotApi.updateConfig('all', { enabled: nextEnabled });
      } else {
        const updated = await aiBotApi.updateConfig(selectedSessionId, { enabled: nextEnabled });
        setConfig(updated);
      }
      toast.success(`AI API Engine ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      setEnabled(previousEnabled);
      toast.error('Failed to update AI API engine status', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleFallbackStatus = async (nextFallback: boolean) => {
    if (!selectedSessionId || isSaving) return;

    const previousFallback = fallbackEnabled;
    setFallbackEnabled(nextFallback);
    setIsSaving(true);

    try {
      if (selectedSessionId === 'all') {
        await aiBotApi.updateConfig('all', { fallbackEnabled: nextFallback });
      } else {
        const updated = await aiBotApi.updateConfig(selectedSessionId, { fallbackEnabled: nextFallback });
        setConfig(updated);
      }
      toast.success(`Default Fallback Bot (ChatGPT) ${nextFallback ? 'enabled' : 'disabled'}`);
    } catch (err) {
      setFallbackEnabled(previousFallback);
      toast.error('Failed to update fallback bot status', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveMasterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;

    setIsSaving(true);
    try {
      if (selectedSessionId === 'all') {
        await savePayload('all');
        await Promise.all(sessions.map(s => savePayload(s.id).catch(() => null)));
        toast.success('AI Settings applied to ALL WhatsApp sessions!');
      } else {
        const updated = await savePayload(selectedSessionId);
        setConfig(updated);
        setApiKey(updated.apiKey);
        toast.success('AI Settings saved successfully!');
      }
    } catch (err) {
      toast.error('Failed to save settings', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const getAgentFormFromTemplate = (role: AgentRole) => {
    const template = AGENT_TEMPLATES[role];
    return {
      name: template.name,
      role: template.role,
      enabled: true,
      priority: template.priority,
      triggerKeywords: template.triggerKeywords.join(', '),
      audience: 'all' as const,
      targetNumbers: '',
      messageTypes: '',
      similarMessages: '',
      description: template.description,
      systemPrompt: template.systemPrompt,
      knowledgeBase: template.knowledgeBase,
    };
  };

  const handleOpenCreateModal = (presetKey: AgentRole = 'custom') => {
    setEditingAgentId(null);
    const form = getAgentFormFromTemplate(presetKey);
    setAgentForm(form);
    const { docs, manualNotes } = parseExistingDocuments(form.knowledgeBase);
    setAgentDocuments(docs);
    setCustomNotes(manualNotes);
    setActiveKbTab('documents');
    setIsModalOpen(true);
  };

  const handleAgentRoleChange = (role: AgentRole) => {
    const templateForm = getAgentFormFromTemplate(role);
    const { docs, manualNotes } = parseExistingDocuments(templateForm.knowledgeBase);
    setAgentDocuments(docs);
    setCustomNotes(manualNotes);
    setAgentForm(current => ({
      ...templateForm,
      enabled: current.enabled,
    }));
  };

  const handleOpenEditModal = (agent: AiAgentView) => {
    setEditingAgentId(agent.id);
    const kb = agent.knowledgeBase || '';
    const { docs, manualNotes } = parseExistingDocuments(kb);
    setAgentDocuments(docs);
    setCustomNotes(manualNotes);
    setActiveKbTab(docs.length > 0 ? 'documents' : 'manual');
    setAgentForm({
      name: agent.name,
      role: agent.role,
      enabled: agent.enabled,
      priority: agent.priority,
      triggerKeywords: (agent.triggerKeywords || []).join(', '),
      audience: agent.audience || 'all',
      targetNumbers: (agent.targetNumbers || []).join(', '),
      messageTypes: (agent.messageTypes || []).join(', '),
      similarMessages: (agent.similarMessages || []).join('\n'),
      description: agent.description || '',
      systemPrompt: agent.systemPrompt,
      knowledgeBase: kb,
    });
    setIsModalOpen(true);
  };

  const handleCustomNotesChange = (text: string) => {
    setCustomNotes(text);
    setAgentForm(prev => ({
      ...prev,
      knowledgeBase: compileKnowledgeBase(agentDocuments, text),
    }));
  };

  const handleProcessFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsExtractingDoc(true);
    try {
      const added: UploadedDocument[] = [];

      for (const file of fileArray) {
        const docType = getDocumentType(file.name);
        let extractedText = '';

        if (docType === 'csv' || docType === 'text') {
          const rawText = await file.text();
          if (docType === 'csv') {
            const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length > 0) {
              const rows = lines.map(l => l.split(',').map(c => c.trim()));
              const header = rows[0];
              const divider = header.map(() => '---');
              extractedText =
                `| ${header.join(' | ')} |\n` +
                `| ${divider.join(' | ')} |\n` +
                rows
                  .slice(1)
                  .map(r => `| ${r.join(' | ')} |`)
                  .join('\n');
            } else {
              extractedText = rawText;
            }
          } else {
            extractedText = rawText;
          }
        } else {
          // Word (.docx), Excel (.xlsx), PDF (.pdf) -> read as base64 and call backend extractDocument API
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const res = reader.result as string;
              resolve(res.includes(',') ? res.split(',')[1] : res);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const activeSessId =
            selectedSessionId && selectedSessionId !== 'all' ? selectedSessionId : sessions[0]?.id || 'default';

          const res = await aiBotApi.extractDocument(activeSessId, file.name, base64, file.type);
          extractedText = res.extractedText;
        }

        if (!extractedText.trim()) {
          extractedText = `[Attached reference document: ${file.name}]`;
        }

        added.push({
          id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          size: file.size,
          type: docType,
          extractedText: extractedText.trim(),
          charCount: extractedText.trim().length,
        });
      }

      const updatedDocs = [...agentDocuments, ...added];
      setAgentDocuments(updatedDocs);
      setAgentForm(prev => ({
        ...prev,
        knowledgeBase: compileKnowledgeBase(updatedDocs, customNotes),
      }));
      toast.success(`Attached and extracted ${fileArray.length} document(s) successfully!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Error processing documents: ${msg}`);
    } finally {
      setIsExtractingDoc(false);
    }
  };

  const handleRemoveDocument = (docId: string) => {
    const updated = agentDocuments.filter(d => d.id !== docId);
    setAgentDocuments(updated);
    setAgentForm(prev => ({
      ...prev,
      knowledgeBase: compileKnowledgeBase(updated, customNotes),
    }));
    toast.success('Document removed from knowledge base');
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentForm.name.trim()) {
      toast.error('Please enter an Agent Name');
      return;
    }

    const keywords = agentForm.triggerKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const compiledKb = compileKnowledgeBase(agentDocuments, customNotes);

    const payload: CreateAiAgentInput = {
      name: agentForm.name.trim(),
      role: agentForm.role,
      enabled: agentForm.enabled,
      priority: Number(agentForm.priority) || 0,
      triggerKeywords: keywords,
      audience: agentForm.audience,
      targetNumbers: agentForm.targetNumbers
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      messageTypes: agentForm.messageTypes
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean),
      similarMessages: agentForm.similarMessages
        .split('\n')
        .map(value => value.trim())
        .filter(Boolean),
      description: agentForm.description.trim(),
      systemPrompt: agentForm.systemPrompt.trim(),
      knowledgeBase: compiledKb.trim(),
    };

    const targetSession = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;

    try {
      if (editingAgentId) {
        await aiBotApi.updateAgent(targetSession, editingAgentId, payload);
        toast.success(`Agent "${payload.name}" updated successfully!`);
      } else {
        await aiBotApi.createAgent(targetSession, payload);
        toast.success(`Agent "${payload.name}" created successfully!`);
      }
      setIsModalOpen(false);
      loadAgents(targetSession);
    } catch (err) {
      toast.error('Failed to save agent', err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteAgent = async (agent: AiAgentView) => {
    if (!confirm(`Are you sure you want to delete AI Agent "${agent.name}"?`)) return;
    const targetSession = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;
    try {
      await aiBotApi.deleteAgent(targetSession, agent.id);
      toast.success(`Agent "${agent.name}" deleted`);
      loadAgents(targetSession);
    } catch (err) {
      toast.error('Failed to delete agent', err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleAgentStatus = async (agent: AiAgentView) => {
    const targetSession = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;
    try {
      await aiBotApi.updateAgent(targetSession, agent.id, { enabled: !agent.enabled });
      toast.success(`Agent "${agent.name}" ${!agent.enabled ? 'activated' : 'paused'}`);
      loadAgents(targetSession);
    } catch (err) {
      toast.error('Failed to update agent status', err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunTest = async () => {
    if (!testMessage.trim()) return;

    setIsTesting(true);
    setTestResult(null);
    const testSessionId = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;
    try {
      const result = await aiBotApi.testPrompt(testSessionId, testMessage.trim());
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
        title="Multi-Agent AI Chatbot Hub"
        subtitle="Deploy multiple specialized AI chatbots (Sales, Support, Custom) on your WhatsApp numbers"
      />

      {/* Session selector & Master Status Bar */}
      <div className="ai-chatbot-session-bar">
        <div className="session-select-wrapper">
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
              <option value="all">🌟 All Sessions (બધા જ સેશન - Global)</option>
              {sessions.map((s: Session) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="master-status-pill">
          <div className="status-pill-item">
            <span className={`status-indicator ${enabled ? 'active' : 'inactive'}`} />
            <span>
              API Engine: <strong>{enabled ? 'Active' : 'Disabled'}</strong>
            </span>
          </div>
          <span className="pill-divider">|</span>
          <div className="status-pill-item">
            <span className={`status-indicator ${fallbackEnabled ? 'active' : 'inactive'}`} />
            <span>
              ChatGPT Fallback: <strong>{fallbackEnabled ? 'ON' : 'OFF (Safe Mode)'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Modern Luxury Tabs */}
      <div className="ai-chatbot-tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          <Bot size={18} />
          <span>Specialized AI Chatbots ({agents.length})</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Sliders size={18} />
          <span>Global AI Credentials & Fallback Bot</span>
        </button>
      </div>

      {isLoadingConfig ? (
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <span>Loading Multi-Agent System...</span>
        </div>
      ) : (
        <div className="ai-chatbot-layout">
          {/* TAB 1: Specialized Agents Manager */}
          {activeTab === 'agents' && (
            <div className="agents-tab-container">
              {/* Status Alert Banners */}
              {!enabled ? (
                <div className="fallback-disabled-banner warning">
                  <AlertCircle size={18} />
                  <div>
                    <strong>AI API Engine is Disabled:</strong> Specialized Chatbots are paused. Turn ON the{' '}
                    <strong>AI API Engine Switch</strong> in the &quot;Global AI Credentials &amp; Fallback Bot&quot;
                    tab to activate AI responses.
                  </div>
                </div>
              ) : !fallbackEnabled ? (
                <div className="fallback-disabled-banner safe">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>Clean Mode Active (ChatGPT Fallback OFF):</strong> Only your active specialized bots will
                    reply when keywords match. Personal chats and general unhandled messages will <strong>never</strong>{' '}
                    get automated replies.
                  </div>
                </div>
              ) : (
                <div className="fallback-disabled-banner info">
                  <Bot size={18} />
                  <div>
                    <strong>Dual Mode Active:</strong> Specialized bots reply on keyword matches, and ChatGPT Fallback
                    is ON to answer any unhandled messages.
                  </div>
                </div>
              )}

              {/* Top Action Banner */}
              <div className="agents-action-banner">
                <div className="banner-info">
                  <h3>Specific AI Chatbots for Specific Tasks</h3>
                  <p>
                    Create targeted agents like <strong>Sales Bot</strong> for pricing & deals, or{' '}
                    <strong>Support Bot</strong> for complaints & help. Incoming WhatsApp messages are automatically
                    routed based on triggers!
                  </p>
                </div>
                <div className="banner-buttons">
                  <button
                    type="button"
                    className="btn-preset-agent sales"
                    onClick={() => handleOpenCreateModal('sales')}
                  >
                    <ShoppingBag size={16} />+ Add Sales Bot
                  </button>
                  <button
                    type="button"
                    className="btn-preset-agent support"
                    onClick={() => handleOpenCreateModal('support')}
                  >
                    <Headphones size={16} />+ Add Support Bot
                  </button>
                  <button
                    type="button"
                    className="btn-preset-agent billing"
                    onClick={() => handleOpenCreateModal('billing')}
                  >
                    <CreditCard size={16} />+ Add Payment Bot
                  </button>
                  <button
                    type="button"
                    className="btn-preset-agent inquiry"
                    onClick={() => handleOpenCreateModal('inquiry')}
                  >
                    <CircleHelp size={16} />+ Add FAQ Bot
                  </button>
                  <button type="button" className="btn-primary-glow" onClick={() => handleOpenCreateModal()}>
                    <Plus size={16} />
                    Create Custom Bot
                  </button>
                </div>
              </div>

              {/* Agents Grid */}
              {isLoadingAgents ? (
                <div className="loading-container">
                  <Loader2 className="animate-spin" size={28} />
                  <span>Loading agents...</span>
                </div>
              ) : agents.length === 0 ? (
                <div className="empty-agents-card">
                  <Bot size={48} className="empty-icon" />
                  <h4>No Specialized Bots Created Yet</h4>
                  <p>Choose Sales, Support, Payment, or FAQ to start with a complete ready-to-use template.</p>
                  <div className="empty-quick-actions">
                    <button
                      type="button"
                      className="btn-preset-agent sales"
                      onClick={() => handleOpenCreateModal('sales')}
                    >
                      <ShoppingBag size={16} /> Add Sales Bot Template
                    </button>
                    <button
                      type="button"
                      className="btn-preset-agent support"
                      onClick={() => handleOpenCreateModal('support')}
                    >
                      <Headphones size={16} /> Add Support Bot Template
                    </button>
                    <button
                      type="button"
                      className="btn-preset-agent billing"
                      onClick={() => handleOpenCreateModal('billing')}
                    >
                      <CreditCard size={16} /> Add Payment Bot Template
                    </button>
                    <button
                      type="button"
                      className="btn-preset-agent inquiry"
                      onClick={() => handleOpenCreateModal('inquiry')}
                    >
                      <CircleHelp size={16} /> Add FAQ Bot Template
                    </button>
                  </div>
                </div>
              ) : (
                <div className="agents-card-grid">
                  {agents.map(agent => {
                    const isSales = agent.role === 'sales';
                    const isSupport = agent.role === 'support';
                    return (
                      <div
                        key={agent.id}
                        className={`agent-card ${agent.enabled ? 'agent-active' : 'agent-inactive'} role-${agent.role}`}
                      >
                        <div className="agent-card-header">
                          <div className="agent-title-box">
                            <div className={`agent-role-badge ${agent.role}`}>
                              {isSales && <ShoppingBag size={14} />}
                              {isSupport && <Headphones size={14} />}
                              {!isSales && !isSupport && <Bot size={14} />}
                              <span>{agent.role.toUpperCase()}</span>
                            </div>
                            <h4>{agent.name}</h4>
                          </div>

                          <div className="agent-card-controls">
                            <label className="switch switch-sm" title="Enable/Disable this agent">
                              <input
                                type="checkbox"
                                checked={agent.enabled}
                                onChange={() => handleToggleAgentStatus(agent)}
                              />
                              <span className="slider round" />
                            </label>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => handleOpenEditModal(agent)}
                              title="Edit Agent"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon delete"
                              onClick={() => handleDeleteAgent(agent)}
                              title="Delete Agent"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        {agent.description && <p className="agent-desc">{agent.description}</p>}

                        <div className="agent-triggers-box">
                          <span className="triggers-label">
                            <Tag size={12} /> Trigger Keywords:
                          </span>
                          <div className="keyword-pills">
                            {agent.triggerKeywords && agent.triggerKeywords.length > 0 ? (
                              agent.triggerKeywords.map((kw, i) => (
                                <span key={i} className="keyword-pill">
                                  {kw}
                                </span>
                              ))
                            ) : (
                              <span className="no-keywords">Matches general inquiries</span>
                            )}
                          </div>
                        </div>

                        <div className="agent-card-meta">
                          <span>
                            Priority: <strong>{agent.priority}</strong>
                          </span>
                          <span>
                            Knowledge Base:{' '}
                            <strong>
                              {(() => {
                                if (!agent.knowledgeBase) return 'None';
                                const { docs } = parseExistingDocuments(agent.knowledgeBase);
                                if (docs.length > 0) {
                                  return `${docs.length} Doc${docs.length > 1 ? 's' : ''} Attached`;
                                }
                                return 'Custom FAQs';
                              })()}
                            </strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Global Config & Fallback Bot */}
          {activeTab === 'settings' && (
            <div className="settings-tab-container">
              <form className="ai-config-card" onSubmit={handleSaveMasterSettings}>
                {/* SECTION 1: AI API ENGINE & CREDENTIALS */}
                <div className="config-section-box">
                  <div className="card-header-toggle">
                    <div className="toggle-title">
                      <div className="section-icon-badge engine">
                        <Key className="icon-bot" size={22} />
                      </div>
                      <div>
                        <h3>1. AI API Engine &amp; Credentials</h3>
                        <p>
                          Master integration switch. Turn this <strong>ON</strong> so your Specialized Chatbots (Sales,
                          Support, Custom) can use the AI API.
                        </p>
                      </div>
                    </div>
                    <label className="switch" title="Toggle AI API engine integration">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => void handleToggleMasterStatus(e.target.checked)}
                        disabled={isSaving}
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
                        <option value="gemini">Google Gemini (Recommended - Free &amp; Fast)</option>
                        <option value="openai">OpenAI (ChatGPT)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="ai-model-select">Model</label>
                      {provider === 'gemini' ? (
                        <select id="ai-model-select" value={model} onChange={e => setModel(e.target.value)}>
                          <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast &amp; Cost-Effective)</option>
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
                    <label htmlFor="ai-cooldown-input">
                      <Zap size={14} /> Cooldown Window (Seconds)
                    </label>
                    <input
                      id="ai-cooldown-input"
                      aria-label="Cooldown Window (Seconds)"
                      type="number"
                      value={cooldownSeconds}
                      onChange={e => setCooldownSeconds(Number(e.target.value))}
                      min={0}
                      max={3600}
                    />
                    <small className="form-hint">
                      Quiet period before the AI sends another reply to the same user. Prevents rapid repetitive
                      messages.
                    </small>
                  </div>
                </div>

                {/* SECTION 2: CHATGPT / GEMINI DEFAULT FALLBACK BOT */}
                <div className="config-section-box fallback-box">
                  <div className="card-header-toggle">
                    <div className="toggle-title">
                      <div className="section-icon-badge fallback">
                        <Bot className="icon-bot" size={22} />
                      </div>
                      <div>
                        <h3>2. Default Fallback Chatbot (ChatGPT / Gemini)</h3>
                        <p>
                          Controls whether ChatGPT replies to <strong>unhandled messages</strong> that do not match any
                          specialized bot. Turn this <strong>OFF</strong> if you only want your specialized bots to
                          reply and want zero unwanted replies on personal chats!
                        </p>
                      </div>
                    </div>
                    <label className="switch" title="Toggle ChatGPT Fallback Bot for unmatched messages">
                      <input
                        type="checkbox"
                        checked={fallbackEnabled}
                        onChange={e => void handleToggleFallbackStatus(e.target.checked)}
                        disabled={isSaving}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>

                  {fallbackEnabled ? (
                    <div className="fallback-notice active">
                      <Bot size={16} />
                      <span>
                        <strong>ChatGPT Fallback is ON:</strong> Unhandled incoming messages will receive automated
                        replies using the settings below.
                      </span>
                    </div>
                  ) : (
                    <div className="fallback-notice safe">
                      <ShieldCheck size={16} />
                      <span>
                        <strong>Safe Mode Active (ChatGPT Fallback OFF):</strong> Unhandled messages will receive{' '}
                        <strong>NO reply</strong>. Only your specialized bots (Sales, Support, etc.) will reply when
                        triggered.
                      </span>
                    </div>
                  )}

                  <div className={`fallback-inputs-wrapper ${!fallbackEnabled ? 'muted-inputs' : ''}`}>
                    <div className="form-group">
                      <div className="label-with-presets">
                        <label>
                          <Sparkles size={14} /> Fallback System Prompt
                        </label>
                        <div className="preset-buttons">
                          <span>Presets:</span>
                          <button type="button" onClick={() => applyPreset('general')}>
                            General
                          </button>
                          <button type="button" onClick={() => applyPreset('gujarati_business')}>
                            ગુજરાતી બિઝનેસ
                          </button>
                          <button type="button" onClick={() => applyPreset('ecommerce')}>
                            E-Commerce
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={4}
                        value={systemPrompt}
                        onChange={e => setSystemPrompt(e.target.value)}
                        placeholder="Instructions for ChatGPT when no specialized bot triggers..."
                      />
                    </div>

                    <div className="form-group">
                      <label>
                        <FileText size={14} /> Fallback Knowledge Base &amp; Business FAQs
                      </label>
                      <textarea
                        rows={5}
                        value={knowledgeBase}
                        onChange={e => setKnowledgeBase(e.target.value)}
                        placeholder="General business details, working hours, location, support contact..."
                      />
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn-save" disabled={isSaving}>
                  {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  {selectedSessionId === 'all' ? 'Save Global Settings for All Sessions' : 'Save AI Settings'}
                </button>
              </form>
            </div>
          )}

          {/* Test & Live Multi-Agent Simulator Panel */}
          <div className="ai-test-card">
            <div className="card-header">
              <Sparkles size={20} className="icon-sparkle" />
              <div>
                <h3>Multi-Agent Live Simulator</h3>
                <p>Test incoming customer inquiries to see which AI Agent triggers and what reply it generates!</p>
              </div>
            </div>

            <div className="test-body">
              <div className="quick-test-queries">
                <span>Try quick queries:</span>
                <button type="button" onClick={() => setTestMessage('What are your package prices and offers?')}>
                  💼 Price Inquiry (Sales)
                </button>
                <button type="button" onClick={() => setTestMessage('I have a problem with my account, please help!')}>
                  🎧 Issue/Help (Support)
                </button>
                <button type="button" onClick={() => setTestMessage('નમસ્તે, તમારી ઓફિસ ક્યાં આવેલી છે?')}>
                  📍 Location (General)
                </button>
              </div>

              <div className="form-group">
                <label>Customer Message</label>
                <div className="test-input-row">
                  <input
                    type="text"
                    value={testMessage}
                    onChange={e => setTestMessage(e.target.value)}
                    placeholder="દા.ત. આ પ્રોડક્ટ નો ભાવ શું છે? / I need support..."
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
                        <span>AI Response</span>
                        {testResult.matchedAgent ? (
                          <span className={`matched-agent-tag ${testResult.matchedAgent.role}`}>
                            Answered by: <strong>{testResult.matchedAgent.name}</strong> ({testResult.matchedAgent.role}
                            )
                          </span>
                        ) : testResult.fallbackDisabled ? (
                          <span className="matched-agent-tag disabled">
                            <ShieldCheck
                              size={14}
                              style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }}
                            />
                            Safe Mode: <strong>Fallback ChatGPT is OFF</strong> (No Reply Sent)
                          </span>
                        ) : (
                          <span className="matched-agent-tag general">
                            Answered by: <strong>Default Fallback Bot (ChatGPT)</strong>
                          </span>
                        )}
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

      {/* Modal: Create or Edit Specialized AI Agent */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <div className="modal-title">
                <Bot size={22} className="modal-icon" />
                <h3>{editingAgentId ? 'Edit AI Chatbot' : 'Create Specialized AI Chatbot'}</h3>
              </div>
              <button type="button" className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAgent} className="modal-form">
              <div className="form-group-row">
                <div className="form-group">
                  <label>Bot Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sales Executive Bot / Support Specialist"
                    value={agentForm.name}
                    onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="agent-role-select">Role / Category</label>
                  <select
                    id="agent-role-select"
                    aria-label="Role / Category"
                    value={agentForm.role}
                    onChange={e => handleAgentRoleChange(e.target.value as AgentRole)}
                  >
                    <option value="sales">💼 Sales (Leads, Products & Deals)</option>
                    <option value="support">🎧 Support (Complaints & Troubleshooting)</option>
                    <option value="billing">💳 Billing & Payment</option>
                    <option value="inquiry">❓ FAQ & Inquiry</option>
                    <option value="custom">⚙️ Custom Purpose</option>
                  </select>
                  <small className="form-hint">
                    Changing the role automatically fills the matching name, triggers, prompt, and FAQ template.
                  </small>
                </div>
              </div>

              <div className="form-group">
                <label>
                  <Tag size={14} /> Trigger Keywords / Phrases (Comma Separated) *
                </label>
                <input
                  type="text"
                  placeholder="price, buy, cost, discount, catalog, demo, ભાવ, કિંમત, ખરીદવું"
                  value={agentForm.triggerKeywords}
                  onChange={e => setAgentForm({ ...agentForm, triggerKeywords: e.target.value })}
                />
                <small className="form-hint">
                  When a customer's WhatsApp message includes any of these words, this specific bot will handle the
                  conversation.
                </small>
              </div>

              <div className="form-group-row">
                <div className="form-group">
                  <label htmlFor="agent-audience-select">Reply Audience</label>
                  <select
                    id="agent-audience-select"
                    aria-label="Reply Audience"
                    value={agentForm.audience}
                    onChange={e =>
                      setAgentForm({ ...agentForm, audience: e.target.value as typeof agentForm.audience })
                    }
                  >
                    <option value="all">All chats</option>
                    <option value="numbers">Only selected contacts</option>
                    <option value="non_contacts">Only non-contacted people</option>
                    <option value="groups">All WhatsApp groups</option>
                    <option value="selected_groups">Only selected groups</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Message Types (optional)</label>
                  <input
                    placeholder="chat, image, document"
                    value={agentForm.messageTypes}
                    onChange={e => setAgentForm({ ...agentForm, messageTypes: e.target.value })}
                  />
                </div>
              </div>
              {(agentForm.audience === 'numbers' || agentForm.audience === 'selected_groups') && (
                <div className="form-group">
                  <label htmlFor="agent-target-input">
                    {agentForm.audience === 'selected_groups' ? 'Target Group IDs' : 'Target Numbers / Contacts'}
                  </label>
                  {agentForm.audience === 'selected_groups' ? (
                    <select
                      aria-label="Quick Select WhatsApp Group"
                      value=""
                      onChange={e => {
                        const val = e.target.value;
                        if (!val) return;
                        const current = agentForm.targetNumbers
                          ? agentForm.targetNumbers
                              .split(',')
                              .map(s => s.trim())
                              .filter(Boolean)
                          : [];
                        if (!current.includes(val)) {
                          setAgentForm({ ...agentForm, targetNumbers: [...current, val].join(', ') });
                        }
                      }}
                      style={{ marginBottom: '8px' }}
                    >
                      <option value="">-- Choose active group to add --</option>
                      {sessionChats
                        .filter(c => c.isGroup || c.id.endsWith('@g.us'))
                        .map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name || g.id}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <select
                      aria-label="Quick Select Contact"
                      value=""
                      onChange={e => {
                        const val = e.target.value;
                        if (!val) return;
                        const current = agentForm.targetNumbers
                          ? agentForm.targetNumbers
                              .split(',')
                              .map(s => s.trim())
                              .filter(Boolean)
                          : [];
                        if (!current.includes(val)) {
                          setAgentForm({ ...agentForm, targetNumbers: [...current, val].join(', ') });
                        }
                      }}
                      style={{ marginBottom: '8px' }}
                    >
                      <option value="">-- Choose active contact to add --</option>
                      {sessionChats
                        .filter(c => !c.isGroup && !c.id.endsWith('@g.us'))
                        .map(c => (
                          <option key={c.id} value={c.id.split('@')[0]}>
                            {c.name || c.id} ({c.id.split('@')[0]})
                          </option>
                        ))}
                    </select>
                  )}
                  <input
                    id="agent-target-input"
                    aria-label={
                      agentForm.audience === 'selected_groups' ? 'Target Group IDs' : 'Target Numbers / Contacts'
                    }
                    placeholder={
                      agentForm.audience === 'selected_groups'
                        ? '120363...@g.us, 987...@g.us'
                        : '919876543210, 919812345678'
                    }
                    value={agentForm.targetNumbers}
                    onChange={e => setAgentForm({ ...agentForm, targetNumbers: e.target.value })}
                  />
                  <small className="form-hint">
                    Comma-separated values. This bot replies only to the selected audience.
                  </small>
                </div>
              )}

              <div className="form-group">
                <label>Similar Message Examples (optional)</label>
                <textarea
                  rows={3}
                  placeholder="Paste one example per line. Similar questions will route to this bot even without exact keywords."
                  value={agentForm.similarMessages}
                  onChange={e => setAgentForm({ ...agentForm, similarMessages: e.target.value })}
                />
              </div>

              <div className="form-group-row">
                <div className="form-group">
                  <label htmlFor="agent-priority-input">Priority (Higher = Evaluated First)</label>
                  <input
                    id="agent-priority-input"
                    aria-label="Priority (Higher = Evaluated First)"
                    type="number"
                    value={agentForm.priority}
                    onChange={e => setAgentForm({ ...agentForm, priority: Number(e.target.value) })}
                    min={0}
                    max={100}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="agent-status-select">Status</label>
                  <select
                    id="agent-status-select"
                    aria-label="Status"
                    value={agentForm.enabled ? 'true' : 'false'}
                    onChange={e => setAgentForm({ ...agentForm, enabled: e.target.value === 'true' })}
                  >
                    <option value="true">Active (Enabled)</option>
                    <option value="false">Paused (Disabled)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Short Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Briefly describe what this bot does..."
                  value={agentForm.description}
                  onChange={e => setAgentForm({ ...agentForm, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>
                  <Sparkles size={14} /> Specialized Persona & Instructions (System Prompt) *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Describe tone, objectives, and specific guidance for this role..."
                  value={agentForm.systemPrompt}
                  onChange={e => setAgentForm({ ...agentForm, systemPrompt: e.target.value })}
                />
              </div>

              {/* Document & Knowledge Base Hub */}
              <div className="form-group kb-section-group">
                <div className="kb-section-header">
                  <label className="kb-main-label">
                    <FileText size={15} /> Knowledge Base & Reference Documents
                  </label>
                  <div
                    className="grounding-badge"
                    title="Strict Grounding: AI answers strictly from your documents with zero hallucination"
                  >
                    <ShieldCheck size={14} />
                    <span>Strict Grounding Active</span>
                  </div>
                </div>

                <div className="kb-tab-toggle" role="tablist" aria-label="Knowledge Base Source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeKbTab === 'documents'}
                    aria-label={`Documents and Spreadsheets tab (${agentDocuments.length} files)`}
                    className={`kb-tab-btn ${activeKbTab === 'documents' ? 'active' : ''}`}
                    onClick={() => setActiveKbTab('documents')}
                  >
                    <UploadCloud size={14} />
                    <span>Documents & Spreadsheets ({agentDocuments.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeKbTab === 'manual'}
                    aria-label="Custom Text and FAQs tab"
                    className={`kb-tab-btn ${activeKbTab === 'manual' ? 'active' : ''}`}
                    onClick={() => setActiveKbTab('manual')}
                  >
                    <FileCode size={14} />
                    <span>Custom Text & FAQs</span>
                  </button>
                </div>

                {activeKbTab === 'documents' ? (
                  <div className="kb-documents-container">
                    <div
                      className={`kb-dropzone ${isDragOver ? 'drag-over' : ''} ${isExtractingDoc ? 'loading' : ''}`}
                      onDragOver={e => {
                        e.preventDefault();
                        setIsDragOver(true);
                      }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.files) {
                          handleProcessFiles(e.dataTransfer.files);
                        }
                      }}
                    >
                      <input
                        type="file"
                        id="kb-doc-upload-input"
                        aria-label="Upload reference documents (PDF, Excel, Word, CSV, text)"
                        multiple
                        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.tsv,.txt,.md,.json"
                        style={{ display: 'none' }}
                        onChange={e => {
                          if (e.target.files) {
                            handleProcessFiles(e.target.files);
                          }
                        }}
                      />
                      {isExtractingDoc ? (
                        <div className="dropzone-status">
                          <Loader2 size={26} className="spin-animate text-primary" />
                          <p className="dropzone-title">Extracting document knowledge...</p>
                          <span className="dropzone-subtitle">Parsing tables, text streams, and catalog structure</span>
                        </div>
                      ) : (
                        <label htmlFor="kb-doc-upload-input" className="dropzone-content">
                          <div className="dropzone-icon-bubble">
                            <UploadCloud size={24} />
                          </div>
                          <p className="dropzone-title">
                            <strong>Click to upload</strong> or drag and drop files
                          </p>
                          <p className="dropzone-subtitle">
                            Attach PDF, Excel (.xlsx, .xls), Word (.docx), CSV, or Text files
                          </p>
                          <div className="file-format-tags">
                            <span className="file-tag tag-pdf">PDF</span>
                            <span className="file-tag tag-xlsx">Excel</span>
                            <span className="file-tag tag-docx">Word</span>
                            <span className="file-tag tag-csv">CSV</span>
                            <span className="file-tag tag-txt">Text</span>
                          </div>
                        </label>
                      )}
                    </div>

                    {agentDocuments.length > 0 && (
                      <div className="uploaded-docs-list">
                        <div className="docs-list-header">
                          <span>Attached Documents ({agentDocuments.length})</span>
                          <span className="total-chars">
                            {agentDocuments.reduce((acc, d) => acc + d.charCount, 0).toLocaleString()} characters
                            extracted
                          </span>
                        </div>

                        <div className="docs-grid">
                          {agentDocuments.map(doc => (
                            <div key={doc.id} className={`doc-item-card doc-type-${doc.type}`}>
                              <div className="doc-icon-wrapper">
                                {doc.type === 'pdf' && <FileText size={18} className="doc-icon pdf-icon" />}
                                {doc.type === 'excel' && <FileSpreadsheet size={18} className="doc-icon excel-icon" />}
                                {doc.type === 'word' && <FileText size={18} className="doc-icon word-icon" />}
                                {doc.type === 'csv' && <FileSpreadsheet size={18} className="doc-icon csv-icon" />}
                                {doc.type === 'text' && <FileCode size={18} className="doc-icon text-icon" />}
                              </div>

                              <div className="doc-info">
                                <div className="doc-name" title={doc.name}>
                                  {doc.name}
                                </div>
                                <div className="doc-meta">
                                  <span className="doc-size">{formatBytes(doc.size)}</span>
                                  <span className="doc-separator">•</span>
                                  <span className="doc-chars">{doc.charCount.toLocaleString()} chars</span>
                                </div>
                              </div>

                              <div className="doc-actions">
                                <button
                                  type="button"
                                  className="btn-doc-action preview"
                                  aria-label={`Preview extracted content for ${doc.name}`}
                                  title="Preview extracted text"
                                  onClick={() => setPreviewDoc(doc)}
                                >
                                  <Eye size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-doc-action remove"
                                  aria-label={`Remove ${doc.name}`}
                                  title="Remove document"
                                  onClick={() => handleRemoveDocument(doc.id)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grounding-info-callout">
                      <ShieldCheck size={16} className="callout-icon" />
                      <div className="callout-text">
                        <strong>Strict Document Grounding Enabled:</strong> The AI will answer inquiries strictly using
                        the verified facts, tables, prices, and policies from these uploaded documents. If an answer
                        cannot be found in the documents, it will politely offer to connect the customer with a team
                        member.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="kb-manual-container">
                    <textarea
                      rows={6}
                      aria-label="Custom knowledge base text and FAQs"
                      placeholder="Add custom business rules, prices, FAQs, or contact escalation details..."
                      value={customNotes}
                      onChange={e => handleCustomNotesChange(e.target.value)}
                    />
                    <small className="form-hint">
                      These custom notes are merged with your attached documents to form this agent's complete knowledge
                      base.
                    </small>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label="Cancel"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary-glow" aria-label="Save Agent">
                  <Save size={16} />
                  {editingAgentId ? 'Save Changes' : 'Create Bot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document Extracted Text Preview Modal */}
      {previewDoc && (
        <div
          className="preview-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Document Content Preview"
          onClick={() => setPreviewDoc(null)}
        >
          <div className="preview-modal-content" onClick={e => e.stopPropagation()}>
            <div className="preview-modal-header">
              <div className="preview-title-box">
                <FileCheck size={20} className="preview-icon text-primary" />
                <div>
                  <h3>{previewDoc.name}</h3>
                  <span className="preview-meta">
                    {formatBytes(previewDoc.size)} • {previewDoc.charCount.toLocaleString()} characters extracted
                  </span>
                </div>
              </div>
              <div className="preview-header-actions">
                <button
                  type="button"
                  className="btn-preview-copy"
                  aria-label="Copy extracted text to clipboard"
                  onClick={() => {
                    navigator.clipboard.writeText(previewDoc.extractedText);
                    setCopiedPreview(true);
                    setTimeout(() => setCopiedPreview(false), 2000);
                  }}
                >
                  {copiedPreview ? <CheckCircle2 size={15} className="text-success" /> : <Copy size={15} />}
                  <span>{copiedPreview ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  className="btn-preview-close"
                  aria-label="Close document preview"
                  onClick={() => setPreviewDoc(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="preview-modal-body">
              <pre className="extracted-text-view">{previewDoc.extractedText}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AiChatbot;
