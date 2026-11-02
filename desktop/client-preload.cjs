// The client window shows either the local setup page or the server's interface; the main
// process checks which page is calling before it does anything.
const {contextBridge, ipcRenderer, webUtils} = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  remote: true,
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreferences: values => ipcRenderer.invoke('set-preferences', values),
  chooseFiles: () => ipcRenderer.invoke('choose-files'),
  chooseFolder: current => ipcRenderer.invoke('choose-folder', current),
  pathForFile: file => webUtils.getPathForFile(file),
  serverInfo: () => ipcRenderer.invoke('server-info'),
  forgetServer: () => ipcRenderer.invoke('forget-server'),
  uploadFiles: paths => ipcRenderer.invoke('upload-files', paths),
  onUploadProgress: callback => ipcRenderer.on('upload-progress', (_event, progress) => callback(progress)),
  saveResult: values => ipcRenderer.invoke('save-result', values),
  savedFolder: key => ipcRenderer.invoke('saved-folder', key),
  renameLocal: values => ipcRenderer.invoke('rename-local', values),
  openLocalFolder: key => ipcRenderer.invoke('open-local-folder', key),
});

contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('setup-info'),
  search: () => ipcRenderer.invoke('setup-search'),
  register: values => ipcRenderer.invoke('setup-register', values),
  retry: () => ipcRenderer.invoke('setup-retry'),
  cancel: () => ipcRenderer.invoke('setup-cancel'),
  onStatus: callback => ipcRenderer.on('setup-status', (_event, status) => callback(status)),
});
