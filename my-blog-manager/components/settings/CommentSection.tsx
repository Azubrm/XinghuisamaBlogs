"use client";

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Save, Key, User, GitBranch, Shield } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface CommentSectionProps {
  formData: any;
  handleUpdate: (field: string, value: any) => void;
  pushToQueue: (label: string, key?: string, value?: any) => void;
}

export default function CommentSection({ formData, handleUpdate, pushToQueue }: CommentSectionProps) {
  const gitalk = formData.gitalkConfig || {
    clientID: '',
    clientSecret: '',
    repo: '',
    owner: '',
    admin: []
  };
  const { showToast } = useToast();
  const [newSecret, setNewSecret] = useState('');
  const [secretClientId, setSecretClientId] = useState('');
  const [savingSecret, setSavingSecret] = useState(false);
  const clientId = String(gitalk.clientID || '').trim();
  const secretConfigured = Boolean(clientId) && secretClientId === clientId;

  useEffect(() => {
    let active = true;
    setSecretClientId('');
    setNewSecret('');
    fetch(`/api/github/config?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
      .then(response => response.json())
      .then(data => { if (active && data.configured) setSecretClientId(clientId); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clientId]);

  const updateGitalk = (key: string, value: any) => {
    handleUpdate('gitalkConfig', { ...gitalk, [key]: value, clientSecret: '' });
  };

  const saveToQueue = () => {
    pushToQueue('Gitalk 评论系统', 'gitalkConfig', { ...gitalk, clientSecret: '' });
  };

  const saveSecret = async () => {
    if (!clientId || !newSecret.trim()) {
      showToast('请先填写 Client ID 和新生成的 Client Secret', 'warning');
      return;
    }
    setSavingSecret(true);
    try {
      const response = await fetch('/api/github/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret: newSecret.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        showToast(data.message || '密钥保存失败，请稍后重试', 'error');
        return;
      }
      setSecretClientId(clientId);
      setNewSecret('');
      showToast('密钥已保存到本机，无需同步 Blog', 'success');
    } catch {
      showToast('无法保存密钥，请确认本地管理器正在运行', 'error');
    } finally {
      setSavingSecret(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col gap-6"
    >
      <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/50 dark:border-slate-800/50 rounded-[40px] p-8 shadow-xl">
        <div className="flex justify-between items-center mb-8 border-b border-white/30 dark:border-slate-700/50 pb-6">
          <div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
              <span>💬</span> 评论系统配置
            </h2>
            <p className="text-slate-500 text-sm mt-1 font-bold">对接 GitHub Issue 构建的全站评论系统</p>
          </div>
          <button
            onClick={saveToQueue}
            className="px-6 py-3 bg-indigo-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-indigo-500/30 flex items-center gap-2 hover:bg-indigo-600 transition-colors"
          >
            <Save size={16} /> 暂存公开配置
          </button>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 flex items-center gap-2"><Key size={14} className="text-indigo-400" /> Client ID</label>
              <input
                type="text"
                aria-label="GitHub OAuth Client ID"
                disabled={savingSecret}
                value={gitalk.clientID}
                onChange={(e) => updateGitalk('clientID', e.target.value)}
                className="w-full bg-white/50 dark:bg-slate-800/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono dark:text-slate-200"
                placeholder="请输入 OAuth Apps 的 Client ID"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 flex items-center gap-2"><Shield size={14} className="text-red-400" /> Client Secret（仅保存在本机）</label>
              <input
                type="password"
                aria-label="GitHub OAuth Client Secret"
                autoComplete="new-password"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                disabled={savingSecret}
                className="w-full bg-white/50 dark:bg-slate-800/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono dark:text-slate-200"
                placeholder={secretConfigured ? '已保存；需要更换时输入新密钥' : '粘贴同一个 OAuth App 生成的 Secret'}
              />
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button type="button" onClick={saveSecret} disabled={savingSecret || !newSecret.trim()} className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                  {savingSecret ? '保存中…' : '保存密钥到本机'}
                </button>
                <span role="status" className={`text-xs ${secretConfigured ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {secretConfigured ? '密钥已保存，内容不会回显' : '尚未保存此应用的密钥'}
                </span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            密钥单独保存后即可用于本地登录，不进入操作队列或 Blog 同步。部署到云端时，需要在服务器设置 GITHUB_CLIENT_SECRET。
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              {/* 🌟 核心修复：这里换成了 GitBranch */}
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 flex items-center gap-2"><GitBranch size={14} className="text-slate-600 dark:text-slate-300" /> GitHub 仓库名 (Repo)</label>
              <input
                type="text"
                value={gitalk.repo}
                onChange={(e) => updateGitalk('repo', e.target.value)}
                className="w-full bg-white/50 dark:bg-slate-800/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono dark:text-slate-200"
                placeholder="例如: XHSBlogComment"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 flex items-center gap-2"><User size={14} className="text-blue-400" /> 仓库拥有者 (Owner)</label>
              <input
                type="text"
                value={gitalk.owner}
                onChange={(e) => updateGitalk('owner', e.target.value)}
                className="w-full bg-white/50 dark:bg-slate-800/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono dark:text-slate-200"
                placeholder="你的 GitHub 用户名"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 flex items-center gap-2"><Shield size={14} className="text-purple-400" /> 管理员列表 (Admin)</label>
            <input
              type="text"
              value={gitalk.admin.join(', ')}
              onChange={(e) => {
                const adminArray = e.target.value.split(',').map(item => item.trim()).filter(item => item !== '');
                updateGitalk('admin', adminArray);
              }}
              className="w-full bg-white/50 dark:bg-slate-800/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono dark:text-slate-200"
              placeholder="管理员的 GitHub 用户名，多个请用英文逗号(,)分隔"
            />
            <p className="text-xs text-slate-400 mt-2 ml-1">拥有这些 GitHub 账号的人可以初始化和管理评论区。通常写你自己的账号即可。</p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
