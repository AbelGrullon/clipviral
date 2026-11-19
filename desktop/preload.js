const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch((err) => {
  // Electron agrega "Error invoking remote method…" al mensaje; lo quitamos para mostrarlo limpio.
  throw new Error(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
});
const on = (channel) => (cb) => {
  const handler = (e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  appInfo: () => invoke('app:info'),
  // Licencia (versión para clientes) y generador de claves (tu versión)
  licencia: () => invoke('licencia:estado'),
  activarLicencia: (key) => invoke('licencia:activar', key),
  onLicenciaVencida: on('licencia:vencida'),
  licenciasLista: () => invoke('licencias:lista'),
  generarLicencia: (data) => invoke('licencias:generar', data),
  serverInfo: () => invoke('server:info'),
  serverTest: (url) => invoke('server:test', url),
  serverUse: (url) => invoke('server:use', url),
  cookiesInfo: () => invoke('cookies:info'),
  cookiesPick: () => invoke('cookies:pick'),
  cookiesSet: (mode) => invoke('cookies:set', mode),
  cookiesTest: (url) => invoke('cookies:test', url),
  // YouTube pide las cookies: se abre la guía para exportarlas desde Chrome o Edge.
  onCookiesNeeded: on('cookies:needed'),
  cookiesGuideSeen: () => invoke('cookies:guide-seen'),
  openUrl: (url) => invoke('shell:open', url),
  copy: (text) => invoke('clipboard:write', text),
  paste: () => invoke('clipboard:read'),

  session: () => invoke('auth:session'),
  login: (data) => invoke('auth:login', data),
  register: (data) => invoke('auth:register', data),
  logout: () => invoke('auth:logout'),
  changePassword: (data) => invoke('auth:changePassword', data),
  forgotPassword: (email) => invoke('auth:forgot', email),
  resetPassword: (data) => invoke('auth:reset', data),
  // Pagos con tarjeta (PayPal)
  payStatus: () => invoke('pay:status'),
  payStart: (data) => invoke('pay:start', data),
  payVerify: (id) => invoke('pay:verify', id),
  myPayments: () => invoke('pay:mine'),
  // Clave de Claude (solo administradores). La app nunca recibe la clave completa.
  claudeKey: () => invoke('claude:status'),
  saveClaudeKey: (key) => invoke('claude:save', key),
  removeClaudeKey: () => invoke('claude:remove'),

  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  pickFolder: () => invoke('dialog:folder'),

  componentsStatus: () => invoke('components:status'),
  installComponent: (id, opts) => invoke('components:install', id, opts),
  onComponentsChanged: on('components:changed'),
  pullOllama: (model) => invoke('ollama:pull', model),
  onComponentProgress: on('components:progress'),
  onOllamaProgress: on('ollama:progress'),

  startEngine: (opts) => invoke('engine:start', opts),
  stopEngine: () => invoke('engine:stop'),
  engineState: () => invoke('engine:state'),
  camaraFoto: () => invoke('camara:foto'),
  camaraGuardar: (channel, box) => invoke('camara:guardar', { channel, box }),
  camaraLista: () => invoke('camara:lista'),
  onLog: on('engine:log'),
  onStats: on('engine:stats'),
  onActivity: on('engine:activity'),
  onClip: on('engine:clip'),
  onProducing: on('engine:producing'),
  onDone: on('engine:done'),
  onModeChange: on('engine:mode'),

  listClips: () => invoke('clips:list'),
  deleteClip: (id) => invoke('clips:delete', id),
  revealClip: (file) => invoke('clips:reveal', file),
  openClipFile: (id) => invoke('clips:openFile', id),
  openClipsFolder: () => invoke('clips:openFolder'),

  checkUpdates: () => invoke('updates:check'),
  installUpdate: () => invoke('updates:install'),
  onUpdateProgress: on('updates:progress'),

  systemCheck: (mode) => invoke('system:check', mode),
  perfState: () => invoke('perf:state'),
  perfAnalyze: () => invoke('perf:analyze'),
  perfApply: () => invoke('perf:apply'),
  perfDismiss: (key) => invoke('perf:dismiss', key),
  openOllama: () => invoke('ollama:open'),
  updateYtdlp: () => invoke('ytdlp:update'),
  pickImage: (kind) => invoke('dialog:image', kind),

  socialList: () => invoke('social:list'),
  socialConnect: (platform) => invoke('social:connect', platform),
  socialDisconnect: (platform) => invoke('social:disconnect', platform),
  socialSetPage: (pageId) => invoke('social:setPage', pageId),
  // Uso personal: conectar pegando un token de las herramientas de Meta (el token va directo al servidor local).
  socialManual: (platform, token) => invoke('social:manual', { platform, token }),
  uploadsList: () => invoke('uploads:list'),
  uploadsAdd: (data) => invoke('uploads:add', data),
  uploadsRetry: (id) => invoke('uploads:retry', id),
  uploadsCancel: (id) => invoke('uploads:cancel', id),
  uploadsNow: (id) => invoke('uploads:now', id),
  uploadsClear: () => invoke('uploads:clear'),
  captionPreview: (data) => invoke('uploads:preview', data),
  onUploadUpdate: on('uploads:update'),

  // Clips sugeridos (listos para que el usuario los publique)
  sugList: () => invoke('sug:list'),
  sugAdd: (clipId) => invoke('sug:add', clipId),
  sugMark: (data) => invoke('sug:mark', data),
  sugClear: () => invoke('sug:clear'),
  onSugUpdate: on('sug:update'),
  // Publicación automática y TikTok
  sugPublish: (data) => invoke('sug:publish', data),
  autoSet: (data) => invoke('auto:set', data),
  tiktokInfo: () => invoke('tiktok:info'),
  tiktokApprove: (data) => invoke('tiktok:approve', data),

  // Piloto automático
  pilotState: () => invoke('piloto:state'),
  pilotCheck: () => invoke('piloto:check'),
  pilotDecide: (id, action) => invoke('piloto:decide', id, action),
  pilotClear: () => invoke('piloto:clear'),
  pilotAddChannel: (input) => invoke('piloto:addChannel', input),
  pilotAddVideo: (url) => invoke('piloto:addVideo', url),
  onPilotUpdate: on('piloto:update'),
  onPilotLog: on('piloto:log'),
  onEngineStarted: on('engine:started'),

  // Estadísticas y competencia
  statsState: () => invoke('stats:state'),
  statsRefresh: () => invoke('stats:refresh'),
  onStatsUpdate: on('stats:update'),
  compState: () => invoke('comp:state'),
  compAnalyze: (opts) => invoke('comp:analyze', opts),
  compAdd: (data) => invoke('comp:add', data),
  compRemove: (index) => invoke('comp:remove', index),
  onCompUpdate: on('comp:update'),

  // Agente de contenido (solo admin)
  agentState: () => invoke('agente:state'),
  agentRemote: () => invoke('agente:remoto'),
  agentActivate: (on) => invoke('agente:activar', on),
  agentConfig: (patch) => invoke('agente:config', patch),
  agentPage: (pageId) => invoke('agente:pagina', pageId),
  agentCap: (usd) => invoke('agente:tope', usd),
  agentNow: () => invoke('agente:ahora'),
  agentReplan: () => invoke('agente:replan'),
  agentNumbers: () => invoke('agente:numeros'),
  agentPublishNow: (id) => invoke('agente:publicarYa', id),
  agentDiscard: (id) => invoke('agente:descartar', id),
  agentReschedule: (id, at) => invoke('agente:reprogramar', id, at),
  agentStop: () => invoke('agente:detener'),
  agentFolder: (kind) => invoke('agente:carpeta', kind),
  agentOpenVideo: (file) => invoke('agente:ver', file),
  onAgentUpdate: on('agente:update'),
});
