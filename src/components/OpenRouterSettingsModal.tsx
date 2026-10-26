import React, { useState } from "react";
import { OPENROUTER_MODELS, testOpenRouterKey } from "../services/openrouter";
import {
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  X,
  ExternalLink,
  Save,
  Download,
  ShieldCheck,
  RefreshCw,
  Cpu,
} from "lucide-react";
import confetti from "canvas-confetti";

interface OpenRouterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  openRouterKey: string;
  onSaveKey: (key: string) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onExportBackup: () => void;
}

export const OpenRouterSettingsModal: React.FC<OpenRouterSettingsModalProps> = ({
  isOpen,
  onClose,
  openRouterKey,
  onSaveKey,
  selectedModel,
  onSelectModel,
  onExportBackup,
}) => {
  const [keyInput, setKeyInput] = useState(openRouterKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testOpenRouterKey(keyInput);
      setTestResult(res);
      if (res.success) {
        confetti({
          particleCount: 30,
          spread: 60,
          origin: { y: 0.6 },
          colors: ["#10b981", "#3b82f6"],
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    onSaveKey(keyInput.trim());
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#141721] rounded-4xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 text-white dark:text-slate-900 flex items-center justify-center shadow-md">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                OpenRouter AI & Second Brain Settings
              </h3>
              <p className="text-xs text-slate-400">Configure your personal OpenRouter API key & neural engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[500px]">
          {/* API Key Input Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                OpenRouter API Key
              </label>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <span>Get API Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative flex items-center">
              <input
                type={showKey ? "text" : "password"}
                placeholder="sk-or-v1-xxxxxxxxxxxxxxxx..."
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setTestResult(null);
                }}
                className="w-full bg-slate-100 dark:bg-slate-800/80 text-xs font-mono text-slate-800 dark:text-slate-100 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-24"
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleTestKey}
                  disabled={testing || !keyInput}
                  className="px-2.5 py-1 text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-40"
                >
                  {testing ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Test"}
                </button>
              </div>
            </div>

            {/* Test result message */}
            {testResult && (
              <div
                className={`p-3 rounded-2xl text-xs flex items-center gap-2 ${
                  testResult.success
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/50"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-normal">
              Your key is saved locally on your device (and in Rust core <code className="font-mono text-slate-600 dark:text-slate-300">~/.second_brain_ai/openrouter.key</code>). It never leaves your machine except to contact OpenRouter.
            </p>
          </div>

          {/* Model Selector */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-purple-500" />
              Default Intelligence Model
            </label>

            <div className="space-y-2">
              {OPENROUTER_MODELS.map((m) => {
                const isSelected = selectedModel === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => onSelectModel(m.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-slate-900 dark:border-white shadow-sm"
                        : "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-extrabold">{m.name}</h4>
                        {m.id === "anthropic/claude-3.5-sonnet" && (
                          <span
                            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                              isSelected
                                ? "bg-white/20 text-white dark:bg-black/10 dark:text-black"
                                : "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                            }`}
                          >
                            Recommended
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-[11px] mt-0.5 ${
                          isSelected ? "text-slate-300 dark:text-slate-600" : "text-slate-400"
                        }`}
                      >
                        {m.desc}
                      </p>
                    </div>

                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        isSelected
                          ? "border-white dark:border-slate-950 bg-white dark:bg-slate-950"
                          : "border-slate-300 dark:border-slate-600"
                      }`}
                    >
                      {isSelected && (
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-900 dark:bg-white"></div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Backup & Export */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Local Data Backup</h4>
              <p className="text-[11px] text-slate-400">Export your tasks, habits, and journals to JSON</p>
            </div>
            <button
              onClick={onExportBackup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
          <span className="text-xs text-emerald-600 font-bold">
            {saveSuccess ? "✓ Settings updated & saved to disk!" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
