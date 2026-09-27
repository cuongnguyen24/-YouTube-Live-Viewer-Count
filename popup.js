const DEFAULT_OPTIONS = {
  refreshIntervalSeconds: 60,
  displayFormat: "full",
  showRefreshButton: true
};

const refreshInput = document.getElementById("refreshIntervalSeconds");
const displayFormatSelect = document.getElementById("displayFormat");
const showRefreshButtonInput = document.getElementById("showRefreshButton");
const statusText = document.getElementById("status");

function normalizeOptions(value) {
  const refreshIntervalSeconds = Number(value.refreshIntervalSeconds);
  const displayFormat = ["full", "number", "numberPeople"].includes(value.displayFormat)
    ? value.displayFormat
    : DEFAULT_OPTIONS.displayFormat;

  return {
    refreshIntervalSeconds: Number.isFinite(refreshIntervalSeconds)
      ? Math.min(Math.max(refreshIntervalSeconds, 10), 3600)
      : DEFAULT_OPTIONS.refreshIntervalSeconds,
    displayFormat,
    showRefreshButton: value.showRefreshButton !== false
  };
}

function renderOptions(options) {
  refreshInput.value = String(options.refreshIntervalSeconds);
  displayFormatSelect.value = options.displayFormat;
  showRefreshButtonInput.checked = options.showRefreshButton;
}

function readOptions() {
  return normalizeOptions({
    refreshIntervalSeconds: refreshInput.value,
    displayFormat: displayFormatSelect.value,
    showRefreshButton: showRefreshButtonInput.checked
  });
}

function saveOptions() {
  const options = readOptions();
  renderOptions(options);

  chrome.storage.sync.set(options, () => {
    statusText.textContent = "Đã lưu";
    window.setTimeout(() => {
      statusText.textContent = "";
    }, 1200);
  });
}

chrome.storage.sync.get(DEFAULT_OPTIONS, (storedOptions) => {
  renderOptions(normalizeOptions(storedOptions));
});

refreshInput.addEventListener("change", saveOptions);
displayFormatSelect.addEventListener("change", saveOptions);
showRefreshButtonInput.addEventListener("change", saveOptions);
