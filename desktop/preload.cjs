const {contextBridge, ipcRenderer, webUtils} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreferences: values => ipcRenderer.invoke('set-preferences', values),
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  chooseFolder: current => ipcRenderer.invoke('choose-folder', current),
  pathForFile: file => webUtils.getPathForFile(file),
});
