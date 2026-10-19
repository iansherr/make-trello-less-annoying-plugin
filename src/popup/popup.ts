import './popup.css';
import '../trelloCardNumberPlus.css';
import { Configs, configStorage } from '../shared/storage';
import { formatCardBadge, isBoardExcluded, pickOverlayTextColor } from '../shared/utils';
import { TCNP_NUMBER_CLASS_BOLD } from '../shared/const';
import Huebee from 'huebee';

new Huebee('#number-color', {
  saturations: 1,
  customColors: [
    '#ff0000',
    '#ff7f00',
    '#ffff00',
    '#7fff00',
    '#00ff00',
    '#00ff7f',
    '#00ffff',
    '#007fff',
    '#0000ff',
    '#7f00ff',
    '#ff00ff',
    '#ff0088',
  ],
  staticOpen: true,
}).on('change', () => {
  updatePreview();
});

//#region Configs logic
function loadConfigs() {
  configStorage.get((configs) => {
    getInput(Controls.CardCountersActive).checked = configs.cardCountersActive;
    getInput(Controls.CardNumbersActive).checked = configs.cardNumbersActive;
    getInput(Controls.CardNumbersBold).checked = configs.cardNumbersBold;
    getInput(Controls.NumberFormat).value = configs.numberFormat;
    getSelect(Controls.BadgePlacement).value = configs.badgePosition ?? 'before';
    getSelect(Controls.BadgeStyle).value = configs.badgeStyle ?? 'inline';
    getSelect(Controls.OverlayCorner).value = configs.overlayCorner ?? 'top-right';
    getInput(Controls.OverlayAutoContrast).checked = configs.overlayAutoContrast ?? true;
    getInput(Controls.NumberColor).value = configs.numberColor;
    getInput(Controls.ExcludedBoards).value = configs.excludedBoards;
    updatePreview();
    updateSubRowsEnabled();
    updateExcludedBoardsButtonText();
  });
}

function saveConfig(): void {
  const configs = new Configs();
  configs.cardCountersActive = getInput(Controls.CardCountersActive).checked;
  configs.cardNumbersActive = getInput(Controls.CardNumbersActive).checked;
  configs.cardNumbersBold = getInput(Controls.CardNumbersBold).checked;
  configs.numberFormat = getInput(Controls.NumberFormat).value;
  configs.badgePosition = getSelect(Controls.BadgePlacement).value === 'after' ? 'after' : 'before';
  const badgeStyle = getSelect(Controls.BadgeStyle).value;
  configs.badgeStyle = badgeStyle === 'overlay' ? 'overlay' : 'inline';
  const overlayCorner = getSelect(Controls.OverlayCorner).value;
  configs.overlayCorner =
    overlayCorner === 'top-left' || overlayCorner === 'bottom-left' || overlayCorner === 'bottom-right'
      ? overlayCorner
      : 'top-right';
  configs.overlayAutoContrast = getInput(Controls.OverlayAutoContrast).checked;
  configs.numberColor = getInput(Controls.NumberColor).value;
  configs.excludedBoards = getInput(Controls.ExcludedBoards).value;

  configStorage.set(configs);
}
//#endregion

//#region DOM Utilities
enum Controls {
  CardCountersActive = 'card-counters-active',
  CardNumbersActive = 'card-numbers-active',
  CardNumbersBold = 'card-numbers-bold',
  NumberFormat = 'number-format',
  BadgePlacement = 'badge-placement',
  BadgeStyle = 'badge-style',
  OverlayCorner = 'overlay-corner',
  OverlayAutoContrast = 'overlay-auto-contrast',
  NumberColor = 'number-color',
  ExcludedBoards = 'excludedBoards',
}

function getInput(control: Controls) {
  return getControl<HTMLInputElement>(control);
}

function getSelect(control: Controls) {
  return getControl<HTMLSelectElement>(control);
}

function getControl<T extends HTMLElement>(control: Controls): T {
  return document.getElementById(control) as T;
}

function updatePreview(): void {
  const numberFormat = getInput(Controls.NumberFormat).value;
  const color = getInput(Controls.NumberColor).value;
  const preview = document.getElementById('number-format-preview') as HTMLSpanElement;
  preview.innerText = formatCardBadge(619, 2, 7, numberFormat);
  preview.style.color = color;
  if (getSelect(Controls.BadgeStyle).value === 'overlay') {
    preview.style.backgroundColor = color;
    preview.style.color = pickOverlayTextColor(color, getInput(Controls.OverlayAutoContrast).checked);
    preview.style.borderRadius = '999px';
    preview.style.padding = '0.1em 0.6em';
  } else {
    preview.style.backgroundColor = '';
    preview.style.borderRadius = '';
    preview.style.padding = '';
  }
  preview.classList.toggle(TCNP_NUMBER_CLASS_BOLD, getInput(Controls.CardNumbersBold).checked);
}

function updateSubRowsEnabled(): void {
  const enabled = getInput(Controls.CardNumbersActive).checked;
  const subgroup = document.getElementById('card-numbers-subgroup');
  subgroup?.classList.toggle('disabled', !enabled);
  subgroup?.querySelectorAll('input, select').forEach((el) => {
    (el as HTMLInputElement | HTMLSelectElement).disabled = !enabled;
  });
  const isOverlay = getSelect(Controls.BadgeStyle).value === 'overlay';
  const overlayEnabled = enabled && isOverlay;
  subgroup?.querySelectorAll('.overlay-only').forEach((row) => {
    row.classList.toggle('inactive-option', !isOverlay);
    row.classList.toggle('disabled', !overlayEnabled);
    row.querySelectorAll('input, select').forEach((el) => {
      (el as HTMLInputElement | HTMLSelectElement).disabled = !overlayEnabled;
    });
  });
  subgroup?.querySelectorAll('.inline-only').forEach((row) => {
    row.classList.toggle('inactive-option', isOverlay);
    row.querySelectorAll('input, select').forEach((el) => {
      (el as HTMLInputElement | HTMLSelectElement).disabled = !enabled || isOverlay;
    });
  });
}
//#endregion

async function getCurrentBoardId() {
  const queryOptions = { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);

  return tab?.url?.split('/b/')[1]?.split('/')[0] ?? 'not-found';
}

async function toggleCurrentBoardExcludedBoards() {
  const currentBoard = await getCurrentBoardId();
  const excludedBoards = getInput(Controls.ExcludedBoards).value;

  if (isBoardExcluded(excludedBoards, currentBoard)) {
    const filteredExcludedBoards = excludedBoards
      .split(';')
      .filter((boardId) => boardId.trim() !== currentBoard)
      .join(';');
    getInput(Controls.ExcludedBoards).value = filteredExcludedBoards;
  } else {
    getInput(Controls.ExcludedBoards).value = `${currentBoard};${excludedBoards}`;
  }

  updateExcludedBoardsButtonText();
}

function updateExcludedBoardsButtonText() {
  const excludedBoardsButton = document.getElementById('excludedBoards-toggle-btn');

  if (excludedBoardsButton) {
    getCurrentBoardId().then((currentBoard) => {
      const excludedBoards = getInput(Controls.ExcludedBoards).value;
      excludedBoardsButton.innerText = isBoardExcluded(excludedBoards, currentBoard) ? '(-)' : '(+)';
    });
  }
}

//#region Listeners
document.addEventListener('DOMContentLoaded', loadConfigs);
document.getElementById('save-button')?.addEventListener('click', saveConfig);
document.getElementById('close-button')?.addEventListener('click', () => window.close());
[getInput(Controls.NumberFormat), getInput(Controls.CardNumbersBold)].forEach((el) =>
  el.addEventListener('input', updatePreview)
);
getInput(Controls.CardNumbersActive).addEventListener('change', updateSubRowsEnabled);
getSelect(Controls.BadgeStyle).addEventListener('change', () => {
  updatePreview();
  updateSubRowsEnabled();
});
getInput(Controls.OverlayAutoContrast).addEventListener('change', updatePreview);
document.getElementById('excludedBoards-toggle-btn')?.addEventListener('click', toggleCurrentBoardExcludedBoards);
//#endregion
