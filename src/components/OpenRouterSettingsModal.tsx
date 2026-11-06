import { DialogBackdrop } from "./workspace/DialogBackdrop";
import React, { useEffect, useState } from "react";
import { DEFAULT_MODEL, DEFAULT_VISION_MODEL, getVisionModel, OPENROUTER_MODELS, setVisionModel, testOpenRouterKey, VISION_MODELS } from "../services/openrouter";
import {
  Key,
  Brain,
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

interface OpenRouterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  openRouterKey: string;
  onSaveKey: (key: string) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onExportBackup: () => void;
  workspaceControls?: React.ReactNode;
  onOpenMemory?: () => void;
}

export const OpenRouterSettingsModal: React.FC<OpenRouterSettingsModalProps> = ({
  isOpen,
  onClose,
  openRouterKey,
  onSaveKey,
  selectedModel,
  onSelectModel,
  onExportBackup,
  workspaceControls,
  onOpenMemory,
}) => {
  const [keyInput, setKeyInput] = useState(openRouterKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [modelInput, setModelInput] = useState(selectedModel);
  const [useCustomModel, setUseCustomModel] = useState(
    !OPENROUTER_MODELS.some((model) => model.id === selectedModel),
  );
  const [customModelInput, setCustomModelInput] = useState(useCustomModel ? selectedModel : "");
  const [visionInput, setVisionInput] = useState(getVisionModel);

  useEffect(() => {
    if (!isOpen) {
      setSaveSuccess(false);
      return;
    }
    const isCustom = !OPENROUTER_MODELS.some((model) => model.id === selectedModel);
    setKeyInput(openRouterKey);
    setModelInput(selectedModel);
    setUseCustomModel(isCustom);
    setCustomModelInput(isCustom ? selectedModel : "");
    setVisionInput(getVisionModel());
    setTestResult(null);
  }, [isOpen, openRouterKey, selectedModel]);

  const modelToSave = useCustomModel ? customModelInput.trim() : modelInput;
  const isModelValid = /^[^\s/]+\/[^\s]+$/.test(modelToSave);
  const isVisionValid = /^[^\s/]+\/[^\s]+$/.test(visionInput.trim());

  if (!isOpen) return null;

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testOpenRouterKey(keyInput);
      setTestResult(res);
      if (res.success) {
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!isModelValid || !isVisionValid) return;
    onSaveKey(keyInput.trim());
    onSelectModel(modelToSave);
    setVisionModel(visionInput.trim());
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <DialogBackdrop onClose={onClose} label="Settings and preferences" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-4xl border border-line shadow-2xl w-full max-w-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-raised border border-line text-muted flex items-center justify-center">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight text-ink">
                Settings
              </h3>
              <p className="text-xs text-slate-400">Configure your personal OpenRouter API key & AI model</p>
            </div>
          </div>
          <button aria-label="Close dialog" onClick={onClose}
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
                <ShieldCheck className="w-4 h-4 text-[var(--workspace-success)]" />
                OpenRouter API Key
              </label>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold text-muted dark:text-slate-400 hover:underline flex items-center gap-1"
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
                className="w-full bg-raised text-xs font-mono text-slate-800 dark:text-slate-100 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-24"
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
                  className="px-2.5 py-1 text-[11px] font-bold bg-raised text-muted dark:text-slate-400 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40"
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
                    ? "bg-raised text-[var(--workspace-success)] border border-line"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/50"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[var(--workspace-success)]" />
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
              <Cpu className="w-4 h-4 text-muted" />
              Default Intelligence Model
            </label>

            <div className="space-y-2">
              {OPENROUTER_MODELS.map((m) => {
                const isSelected = !useCustomModel && modelInput === m.id;
                return (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    key={m.id}
                    onClick={() => {
                      setModelInput(m.id);
                      setUseCustomModel(false);
                      setSaveSuccess(false);
                    }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-slate-900 dark:border-white shadow-sm"
                        : "bg-slate-50 dark:bg-slate-900/40 border-line text-slate-800 dark:text-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-extrabold">{m.name}</h4>
                        {m.id === DEFAULT_MODEL && (
                          <span
                            className={`text-[11px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                              isSelected
                                ? "bg-white/20 text-white dark:bg-black/10 dark:text-black"
                                : "bg-raised text-muted dark:bg-raised dark:text-slate-400"
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
                  </button>
                );
              })}
            </div>

            <div className="p-3.5 rounded-2xl border border-line space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold text-ink cursor-pointer">
                <input
                  type="radio"
                  name="custom-openrouter-model"
                  checked={useCustomModel}
                  onChange={() => {
                    setUseCustomModel(true);
                    setSaveSuccess(false);
                  }}
                />
                Custom OpenRouter model
              </label>
              <div className="space-y-2">
                <label htmlFor="custom-openrouter-model-id" className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Model ID
                </label>
                <input
                  id="custom-openrouter-model-id"
                  type="text"
                  value={customModelInput}
                  placeholder="provider/model-name"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="custom-openrouter-model-help"
                  aria-invalid={useCustomModel && !isModelValid}
                  onChange={(event) => {
                    setCustomModelInput(event.target.value);
                    setUseCustomModel(true);
                    setSaveSuccess(false);
                  }}
                  className="w-full bg-raised text-xs font-mono text-ink px-4 py-3 rounded-2xl border border-line focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p id="custom-openrouter-model-help" className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                  Paste the exact model ID from the{" "}
                  <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" className="text-muted dark:text-slate-400 hover:underline">OpenRouter model catalog</a>, including any suffix such as :free. Choose a model that supports tools to use AI actions.
                </p>
                {useCustomModel && !isModelValid && (
                  <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
                    Enter a model ID in provider/model-name format, without spaces.
                  </p>
                )}
              </div>
            </div>
          </div>

          <section className="p-3.5 rounded-2xl border border-line space-y-2" aria-labelledby="vision-model-heading">
            <h4 id="vision-model-heading" className="text-xs font-bold text-ink">Vision model (images)</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Reads pasted screenshots and photos when your chat model can’t see images. Chat models that support images (for example Claude or Gemini) look at them directly. Saved on this device.
            </p>
            <label htmlFor="vision-model-id" className="sr-only">Vision model ID</label>
            <input
              id="vision-model-id"
              list="vision-model-options"
              value={visionInput}
              placeholder={DEFAULT_VISION_MODEL}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!isVisionValid}
              onChange={(event) => { setVisionInput(event.target.value); setSaveSuccess(false); }}
              className="w-full bg-raised text-xs font-mono text-ink px-4 py-3 rounded-2xl border border-line focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="vision-model-options">
              {VISION_MODELS.map((m) => <option key={m.id} value={m.id}>{`${m.name} — ${m.desc}`}</option>)}
            </datalist>
            <div className="flex flex-wrap gap-1.5">
              {VISION_MODELS.map((m) => (
                <button key={m.id} type="button" title={m.desc}
                  onClick={() => { setVisionInput(m.id); setSaveSuccess(false); }}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${visionInput.trim() === m.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-transparent" : "border-line text-slate-600 dark:text-slate-300 hover:border-slate-300"}`}>
                  {m.name}
                </button>
              ))}
            </div>
            {!isVisionValid && <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">Enter a model ID in provider/model-name format.</p>}
          </section>

          {onOpenMemory && <button type="button" className="memory-settings-link" onClick={onOpenMemory}><Brain size={21}/><span><strong>Memory</strong><small>View, edit and manage what Synapse remembers about you</small></span><span className="ml-auto">→</span></button>}
          {workspaceControls && (
            <section className="space-y-2 pt-4 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Workspace & sync</h4>
              {workspaceControls}
            </section>
          )}

          {/* Backup & Export */}
          {!workspaceControls && <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Local data backup</h4>
              <p className="text-[11px] text-slate-400">Export your tasks, habits, and journals to JSON</p>
            </div>
            <button
              onClick={onExportBackup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-raised text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
          <span className="text-xs text-[var(--workspace-success)] font-bold">
            {saveSuccess ? "Settings saved" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button aria-label="Close dialog" onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!isModelValid || !isVisionValid}
              className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary text-white text-xs font-bold shadow-md active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save changes</span>
            </button>
          </div>
        </div>
      </div>
    </DialogBackdrop>
  );
};
