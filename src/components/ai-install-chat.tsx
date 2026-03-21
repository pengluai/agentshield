import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Loader2, User, Sparkles, Crown, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tauriInvoke as invoke } from '@/services/tauri';
import { isEnglishLocale } from '@/constants/i18n';
import { useAppStore } from '@/stores/appStore';

const tr = (zh: string, en: string) => (isEnglishLocale ? en : zh);

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: number;
}

const SYSTEM_PROMPT = `你是 AgentShield 的 AI 安装助手。你的任务是引导用户完成 OpenClaw 的安装和配置。

规则：
1. 用简短、友好的中文回答（如果用户用英文则用英文）
2. 每次只问一个问题，不要一次给太多信息
3. 能自动化的步骤直接告诉用户"我来帮你执行"
4. 需要用户操作的给清晰的步骤说明
5. 不要显示完整的 API Key，只显示前4位...后4位
6. 遇到错误时解释原因并给出修复方案

安装流程：
第0步：检测环境（Node.js 22+, npm, Git）
第1步：npm install -g openclaw@latest
第2步：配置 AI 模型（问用户选 Claude/OpenAI/Gemini/DeepSeek，输入 API Key）
第3步：连接聊天工具（推荐 Telegram 或飞书）
第4步：验证

开场白：先自我介绍，然后说"让我先检查一下你的环境..."`;

interface AiInstallChatProps {
  onClose: () => void;
  isPro: boolean;
}

function TrialQueueCard({ onClose }: { onClose: () => void }) {
  const setCurrentModule = useAppStore((state) => state.setCurrentModule);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="rounded-2xl border border-white/10 backdrop-blur-xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.08) 0%, rgba(4, 47, 46, 0.3) 100%)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(20, 184, 166, 0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {tr('AI 安装助手', 'AI Install Assistant')}
            </h3>
            <p className="text-[11px] text-white/40">MiniMax M2.7 · Pro</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Queue Card Body */}
      <div className="px-5 py-8 flex flex-col items-center text-center space-y-5">
        {/* Animated queue icon */}
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-400/20 flex items-center justify-center"
        >
          <Clock className="w-8 h-8 text-amber-400" />
        </motion.div>

        {/* Queue status */}
        <div className="space-y-2">
          <h4 className="text-base font-semibold text-white">
            {tr('AI 助手 · 排队中', 'AI Assistant · Queued')}
          </h4>
          <p className="text-sm text-white/50 max-w-[280px] leading-relaxed">
            {tr(
              '试用期间，AI 助手处于排队模式。升级 Pro 会员可立即使用，享受优先通道。',
              'During trial, AI assistant is in queue mode. Upgrade to Pro for instant priority access.',
            )}
          </p>
        </div>

        {/* Estimated wait */}
        <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          <span className="text-sm text-white/60">
            {tr('预计等待：约 2-3 小时', 'Estimated wait: ~2-3 hours')}
          </span>
        </div>

        {/* Upgrade button */}
        <button
          type="button"
          onClick={() => setCurrentModule('upgradePro')}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500/90 to-amber-600/90 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 hover:from-amber-500 hover:to-amber-600 transition-all"
        >
          <Crown className="w-4 h-4" />
          {tr('升级 Pro · 立即使用', 'Upgrade to Pro · Use Now')}
        </button>

        {/* Pro benefits */}
        <div className="flex flex-wrap justify-center gap-3 text-xs text-white/40">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-teal-400" />
            {tr('免排队', 'No queue')}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-teal-400" />
            {tr('无限对话', 'Unlimited chats')}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-teal-400" />
            {tr('优先模型', 'Priority model')}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function AiInstallChat({ onClose, isPro }: AiInstallChatProps) {
  if (!isPro) {
    return <TrialQueueCard onClose={onClose} />;
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  const addMessage = useCallback((role: ChatMessage['role'], content: string) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  const callAI = useCallback(async (userMessages: ChatMessage[]) => {
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      const reply = await invoke<string>('pro_ai_chat', {
        messages: apiMessages,
      });
      return reply;
    } catch (error) {
      return tr(
        `AI 连接失败: ${String(error)}。请检查网络或稍后重试。`,
        `AI connection failed: ${String(error)}. Please check your network.`,
      );
    }
  }, []);

  // Auto-start conversation
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    const init = async () => {
      setLoading(true);
      const greeting = addMessage('assistant', tr(
        '你好！我是 AgentShield AI 安装助手 🤖\n让我先检查一下你的环境...',
        'Hi! I\'m the AgentShield AI Install Assistant 🤖\nLet me check your environment first...',
      ));

      // Call AI with initial context
      try {
        const reply = await callAI([
          { id: 'init', role: 'user', content: tr('用户刚打开了安装助手，请自我介绍并开始检测环境。', 'User just opened the install assistant. Introduce yourself and start checking the environment.'), timestamp: Date.now() },
        ]);
        addMessage('assistant', reply);
      } catch {
        addMessage('assistant', tr(
          '环境检测功能需要网络连接。请确保网络正常后重试。',
          'Environment check requires network. Please ensure connectivity and retry.',
        ));
      }
      setLoading(false);
    };

    void init();
  }, [initialized, addMessage, callAI]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    addMessage('user', text);
    setLoading(true);

    const allMessages = [...messages, { id: 'temp', role: 'user' as const, content: text, timestamp: Date.now() }];
    const reply = await callAI(allMessages);
    addMessage('assistant', reply);

    setLoading(false);
    inputRef.current?.focus();
  }, [input, loading, messages, addMessage, callAI]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="rounded-2xl border border-white/10 backdrop-blur-xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.08) 0%, rgba(4, 47, 46, 0.3) 100%)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(20, 184, 166, 0.1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {tr('AI 安装助手', 'AI Install Assistant')}
            </h3>
            <p className="text-[11px] text-white/40">MiniMax M2.7 · Pro</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="h-[400px] overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
      >
        <AnimatePresence>
          {messages.filter((m) => m.role !== 'system').map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
            >
              {/* Avatar */}
              <div className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                msg.role === 'assistant' ? 'bg-teal-500/20' : 'bg-white/10',
              )}>
                {msg.role === 'assistant'
                  ? <Bot className="w-3.5 h-3.5 text-teal-400" />
                  : <User className="w-3.5 h-3.5 text-white/60" />}
              </div>

              {/* Bubble */}
              <div className={cn(
                'max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                msg.role === 'assistant'
                  ? 'bg-white/5 text-white/90 border border-white/5'
                  : 'bg-teal-500/15 text-white/90 border border-teal-500/10',
              )}>
                {msg.content.split('\n').map((line, i) => (
                  <p key={i} className={i > 0 ? 'mt-1.5' : ''}>
                    {line.startsWith('```') ? (
                      <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs font-mono text-teal-300">
                        {line.replace(/```/g, '')}
                      </code>
                    ) : line}
                  </p>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-2.5"
          >
            <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <div className="bg-white/5 border border-white/5 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin" />
              <span className="text-xs text-white/40">{tr('思考中...', 'Thinking...')}</span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder={tr('输入消息...', 'Type a message...')}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-teal-500/30 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
              input.trim() && !loading
                ? 'bg-teal-500/20 text-teal-400 hover:bg-teal-500/30'
                : 'bg-white/5 text-white/20',
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
