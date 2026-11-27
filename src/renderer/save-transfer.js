(() => {
const selectSave = document.querySelector('#select-save');
const confirmImport = document.querySelector('#confirm-import');
const cancelImport = document.querySelector('#cancel-import');
const importStatus = document.querySelector('#import-status');
const importPanel = document.querySelector('#import-preview');
let importToken;

function closeImportPreview() {
  importToken = undefined;
  importPanel.hidden = true;
}

function importError(error) {
  importStatus.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function showPreview(preview) {
  if (!preview) return;
  importToken = preview.token;
  document.querySelector('#import-source').textContent = preview.file + ' · ' + preview.sourceDevice +
    ' · v' + preview.appVersion + ' · ' + new Date(preview.exportedAt).toLocaleString('ko-KR');
  document.querySelector('#import-current').textContent = summarizeSave(preview.current);
  document.querySelector('#import-incoming').textContent = summarizeSave(preview.incoming);
  importPanel.hidden = false;
  cancelImport.focus();
}

window.addEventListener('save-preview', event => {
  closeImportPreview();
  showPreview(event.detail);
});

selectSave.addEventListener('click', async () => {
  closeImportPreview();
  selectSave.disabled = true;
  importStatus.textContent = '';
  try {
    const preview = await window.usage.previewImport();
    showPreview(preview);
  } catch (error) { importError(error); }
  finally { selectSave.disabled = false; }
});

cancelImport.addEventListener('click', () => {
  if (importToken) void window.usage.cancelImport(importToken).catch(importError);
  closeImportPreview();
  selectSave.focus();
});

confirmImport.addEventListener('click', async () => {
  const token = importToken;
  if (!token) return;
  selectSave.disabled = confirmImport.disabled = cancelImport.disabled = true;
  try {
    const result = await window.usage.confirmImport(token);
    window.dispatchEvent(new CustomEvent('settings-companion', { detail: result.companion }));
    importStatus.textContent = result.backupPath
      ? '가져왔습니다. 이전 Windows 저장 백업: ' + result.backupPath
      : '가져왔습니다. 기존 Windows 저장 파일이 없어 백업은 생성되지 않았습니다.';
  } catch (error) { importError(error); }
  finally {
    closeImportPreview();
    selectSave.disabled = confirmImport.disabled = cancelImport.disabled = false;
    selectSave.focus();
  }
});

function summarizeSave(state) {
  return (state.current?.name ?? '알') + ' · 도감 ' + state.collection.length + '종 · 잔액 ' + compactTokens(state.economy.wallet);
}
})();
