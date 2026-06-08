const STORAGE_KEY = 'focusflow-pwa-state-v0.7';
const LEGACY_STORAGE_KEYS = ['focusflow-pwa-state-v0.6', 'focusflow-pwa-state-v0.5', 'focusflow-pwa-state-v0.4', 'focusflow-pwa-state-v0.3', 'focusflow-pwa-state-v0.2', 'focusflow-pwa-state-v0.1'];
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11
};
const WORD_NUMBERS = {
  ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, пару: 2, три: 3, четыре: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  полтора: 1.5, полторы: 1.5
};
const WINDOW_PRESETS = {
  morning: { start: 9 * 60, end: 13 * 60, label: 'утром' },
  afternoon: { start: 13 * 60, end: 17 * 60, label: 'днём' },
  evening: { start: 17 * 60, end: 21 * 60, label: 'вечером' },
  flexible: { start: 9 * 60, end: 20 * 60, label: 'в любое время' }
};

let deferredInstallPrompt = null;
let recognition = null;
let state = loadState();
let currentWeekStart = startOfWeek(new Date());

function $(id) { return document.getElementById(id); }
function loadState() {
  const defaults = {
    tasks: [],
    wellbeing: { energy: 3, stress: 3, sleep: 3, date: isoDate(new Date()) },
    settings: { dayStart: '09:00', dayEnd: '20:00', breakAfterMinutes: 90 },
    manual: { taskDates: {} },
    ui: { theme: 'dark' },
    lastSchedule: []
  };
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const state = {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        wellbeing: parsed.wellbeing || defaults.wellbeing,
        settings: parsed.settings || defaults.settings,
        manual: parsed.manual || { taskDates: {} },
        ui: parsed.ui || { theme: 'dark' },
        lastSchedule: Array.isArray(parsed.lastSchedule) ? parsed.lastSchedule : []
      };
      return state;
    } catch {}
  }
  return defaults;
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function applyTheme() {
  const theme = state.ui?.theme || 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.classList.toggle('active', button.dataset.themeChoice === theme);
  });
}

function setTheme(theme) {
  const allowed = ['dark', 'retro', 'minimal'];
  if (!allowed.includes(theme)) return;
  state.ui = { ...(state.ui || {}), theme };
  saveState();
  applyTheme();
}

function isoDate(date) { return new Date(date).toISOString().slice(0, 10); }
function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function minutesToTime(total) {
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(Math.round(total % 60)).padStart(2, '0');
  return `${h}:${m}`;
}
function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
function formatDate(dateOrIso) {
  const d = new Date(dateOrIso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function safeText(text) {
  return String(text || '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function init() {
  applyTheme();
  setupControls();
  setupSpeech();
  registerServiceWorker();
  scheduleOpenAppReminders();
  ensureTodayWellbeing();
  render();
}

function setupControls() {
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });

  $('parseBtn').addEventListener('click', () => {
    const text = $('captureText').value.trim();
    if (!text) return;
    const parsed = parseTextToTasks(text);
    if (parsed.tasks.length) {
      state.tasks.push(...parsed.tasks);
      state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
      saveState();
      $('captureText').value = '';
      $('parseFeedback').textContent = parsed.message;
      render();
    } else {
      $('parseFeedback').textContent = parsed.message || 'Не увидел новых задач. Попробуй сформулировать чуть конкретнее.';
    }
  });
  $('clearInputBtn').addEventListener('click', () => {
    $('captureText').value = '';
    $('parseFeedback').textContent = '';
  });
  $('rescheduleBtn').addEventListener('click', () => {
    state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
    saveState();
    render();
  });
  $('planTodayBtn').addEventListener('click', () => {
    currentWeekStart = startOfWeek(new Date());
    state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
    saveState();
    render();
  });
  $('resetDemoBtn').addEventListener('click', () => {
    if (!confirm('Стереть все локальные задачи и настройки?')) return;
    [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].forEach(key => localStorage.removeItem(key));
    state = loadState();
    currentWeekStart = startOfWeek(new Date());
    render();
  });
  $('prevWeekBtn').addEventListener('click', () => { currentWeekStart = addDays(currentWeekStart, -7); render(); });
  $('nextWeekBtn').addEventListener('click', () => { currentWeekStart = addDays(currentWeekStart, 7); render(); });
  $('todayWeekBtn').addEventListener('click', () => { currentWeekStart = startOfWeek(new Date()); render(); });
  $('notifyBtn').addEventListener('click', requestNotifications);
  $('exportBtn').addEventListener('click', exportData);
  $('importInput').addEventListener('change', importData);
  $('helpBtn').addEventListener('click', renderHelp);
  $('analyzeBtn').addEventListener('click', renderPlanner);
  $('reliefBtn').addEventListener('click', applyReliefPlan);
  $('gentleTodayBtn').addEventListener('click', makeGentleToday);
  $('clearManualBtn').addEventListener('click', clearAllManualDates);
  $('icsBtn').addEventListener('click', exportIcsCalendar);
  $('pushCheckBtn').addEventListener('click', renderPushStatus);
  $('pushConnectBtn').addEventListener('click', connectPushServer);

  ['energy', 'stress', 'sleep'].forEach(key => {
    const range = $(`${key}Range`);
    const val = $(`${key}Value`);
    range.addEventListener('input', () => {
      state.wellbeing[key] = Number(range.value);
      state.wellbeing.date = isoDate(new Date());
      val.textContent = range.value;
      state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
      saveState();
      render();
    });
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('installBtn').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('installBtn').classList.add('hidden');
  });
}

function ensureTodayWellbeing() {
  const today = isoDate(new Date());
  if (state.wellbeing.date !== today) {
    state.wellbeing = { energy: 3, stress: 3, sleep: 3, date: today };
    saveState();
  }
}

function setupSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = $('voiceBtn');
  if (!SpeechRecognition) {
    $('speechStatus').textContent = 'В этом браузере встроенный голосовой ввод не найден. Можно писать текстом или использовать диктовку клавиатуры iPhone / Windows.';
    voiceBtn.disabled = true;
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    voiceBtn.classList.add('listening');
    $('speechStatus').textContent = 'Слушаю… можно говорить как обычно: задача, время, дедлайн, длительность.';
  };
  recognition.onerror = (event) => {
    $('speechStatus').textContent = `Голосовой ввод остановлен: ${event.error}. Можно ввести текст вручную.`;
    voiceBtn.classList.remove('listening');
  };
  recognition.onend = () => {
    voiceBtn.classList.remove('listening');
    if (!$('captureText').value.trim()) $('speechStatus').textContent = 'Голосовой ввод завершён. Если текст не появился, введи задачу вручную.';
  };
  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
    $('captureText').value = transcript.trim();
  };
  voiceBtn.addEventListener('click', () => recognition.start());
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW failed', e); }
  }
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    alert('В этом браузере нет Notification API.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    new Notification('FocusFlow включён', { body: 'Напоминания будут появляться, пока приложение открыто.' });
    scheduleOpenAppReminders();
  }
}

function scheduleOpenAppReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (window.focusFlowReminderInterval) clearInterval(window.focusFlowReminderInterval);
  window.focusFlowReminderInterval = setInterval(() => {
    const now = new Date();
    const today = isoDate(now);
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const items = state.lastSchedule.filter(item => item.date === today && !isTaskDone(item.taskId));
    items.forEach(item => {
      const task = state.tasks.find(t => t.id === item.taskId);
      if (!task || item.notified) return;
      if (item.startMin - currentMins <= 10 && item.startMin - currentMins >= 0) {
        new Notification('Скоро задача', { body: `${minutesToTime(item.startMin)} — ${task.title}` });
        item.notified = true;
        saveState();
      }
    });
  }, 60 * 1000);
}

function parseTextToTasks(rawText) {
  const cleaned = normalizeText(rawText);
  const today = new Date();
  const wellbeingHint = parseWellbeingHint(cleaned);
  if (wellbeingHint) {
    state.wellbeing = { ...state.wellbeing, ...wellbeingHint, date: isoDate(today) };
  }

  const fragments = splitIntoFragments(cleaned);
  const tasks = fragments.map(fragment => parseFragment(fragment, today)).filter(Boolean);
  const wellbeingMessage = wellbeingHint ? ' Самочувствие тоже обновил.' : '';
  return {
    tasks,
    message: tasks.length
      ? `Добавлено задач: ${tasks.length}.${wellbeingMessage}`
      : `Новых задач не найдено.${wellbeingMessage}`
  };
}

function normalizeText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[—–]/g, '-')
    .trim();
}

function splitIntoFragments(text) {
  const normalized = text
    .replace(/[.!?]+\s+/g, '|||')
    .replace(/\s+(а потом|потом|кроме того|также|и ещё|и еще|ещё|еще)\s+/gi, '|||')
    .replace(/[,;]+\s*(?=(до|к|на|завтра|сегодня|послезавтра|через|в\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|после обеда|утром|вечером|дн[её]м|ночью))/gi, '|||');

  const parts = normalized.split('|||').map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

function parseWellbeingHint(text) {
  const t = text.toLowerCase();
  const hint = {};
  if (/(устал|устала|выгорел|перегруз|нет сил|разгрузи|плохо спал|мало спал|переутом)/.test(t)) {
    hint.energy = Math.min(state.wellbeing.energy, 2);
    hint.stress = Math.max(state.wellbeing.stress, 4);
    hint.sleep = Math.min(state.wellbeing.sleep, 2);
  }
  if (/(много сил|энергии много|заряжен|заряжена|в ресурсе|хорошо спал)/.test(t)) {
    hint.energy = Math.max(state.wellbeing.energy, 4);
    hint.stress = Math.min(state.wellbeing.stress, 2);
    hint.sleep = Math.max(state.wellbeing.sleep, 4);
  }
  return Object.keys(hint).length ? hint : null;
}

function parseFragment(fragment, baseDate) {
  const text = fragment.trim();
  const lower = text.toLowerCase();
  if (!text || text.length < 4) return null;
  if (isWellbeingOnlyFragment(lower)) return null;

  const durationMin = parseDuration(lower) || guessDuration(lower);
  const deadline = parseDeadline(lower, baseDate) || isoDate(addDays(baseDate, 6));
  const priority = parsePriority(lower, deadline);
  const energy = parseTaskEnergy(lower);
  const category = parseCategory(lower);
  const preferredWindow = parseTimeWindow(lower);
  const fixedTime = parseExactTime(lower);
  const bounds = parseTimeBounds(lower);
  const dayPreference = parseDayPreference(lower);
  const spreadDays = parseSpreadDays(lower);
  const title = cleanupTitle(text);
  const notes = buildNotes(text, { preferredWindow, fixedTime, bounds, dayPreference, spreadDays });

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    title: title || text,
    notes,
    durationMin,
    deadline,
    priority,
    energy,
    category,
    preferredWindow,
    fixedTime,
    notBefore: bounds.notBefore,
    notAfter: bounds.notAfter,
    dayPreference,
    spreadDays,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

function isWellbeingOnlyFragment(lower) {
  return /^(я\s+)?(устал|устала|нет сил|разгрузи|плохо спал|мало спал|в ресурсе|заряжен|заряжена|самочувствие.*)$/.test(lower.trim());
}

function buildNotes(originalText, meta) {
  const notes = [];
  if (meta.fixedTime !== null) notes.push(`фиксированное время ${minutesToTime(meta.fixedTime)}`);
  else if (meta.preferredWindow) notes.push(`предпочтительно ${WINDOW_PRESETS[meta.preferredWindow].label}`);
  if (meta.bounds.notBefore !== null) notes.push(`не раньше ${minutesToTime(meta.bounds.notBefore)}`);
  if (meta.bounds.notAfter !== null) notes.push(`не позже ${minutesToTime(meta.bounds.notAfter)}`);
  if (meta.dayPreference === 'weekend') notes.push('предпочтительно на выходных');
  if (meta.dayPreference === 'weekday') notes.push('предпочтительно в будни');
  if (meta.spreadDays > 1) notes.push(`желательно растянуть на ${meta.spreadDays} дн.`);
  if (!notes.length && originalText.length > 0) return '';
  return notes.join(' · ');
}

function parseDuration(text) {
  let match = text.match(/(\d+(?:[.,]\d+)?)\s*(часа|часов|час|ч)\b/);
  if (match) return Math.round(parseFloat(match[1].replace(',', '.')) * 60);
  match = text.match(/(\d+)\s*(минут|минуты|мин)\b/);
  if (match) return Number(match[1]);
  match = text.match(/(полтора|полторы)\s*(часа|часов|час)?\b/);
  if (match) return 90;
  match = text.match(/(\d+)\s+с\s+половиной\s*(часа|часов|час)?\b/);
  if (match) return Math.round((Number(match[1]) + 0.5) * 60);
  match = text.match(/(\w+)\s+с\s+половиной\s*(часа|часов|час)?\b/);
  if (match && WORD_NUMBERS[match[1]]) return Math.round((WORD_NUMBERS[match[1]] + 0.5) * 60);
  match = text.match(/(полчаса|пол часа)\b/);
  if (match) return 30;
  match = text.match(/(четверть часа)\b/);
  if (match) return 15;
  match = text.match(/(пару|один|одну|два|две|три|четыре|пять|шесть)\s*(часа|часов|час)?\b/);
  if (match) return Math.round((WORD_NUMBERS[match[1]] || 1) * 60);
  return null;
}

function guessDuration(text) {
  if (/(позвонить|ответить|написать сообщение|оплатить|купить|забронировать|отправить)/.test(text)) return 30;
  if (/(созвон|встреч|интервью|сессия|консультац)/.test(text)) return 60;
  if (/(презентац|концепц|сценар|стратег|дизайн|монтаж|исслед|разобраться|подготовить|продумать|написать текст)/.test(text)) return 120;
  return 60;
}

function parseDeadline(text, baseDate) {
  if (/послезавтра/.test(text)) return isoDate(addDays(baseDate, 2));
  if (/завтра/.test(text)) return isoDate(addDays(baseDate, 1));
  if (/сегодня/.test(text)) return isoDate(baseDate);
  if (/через\s+(\d+)\s+дн/.test(text)) {
    const days = Number(text.match(/через\s+(\d+)\s+дн/)[1]);
    return isoDate(addDays(baseDate, days));
  }
  if (/(до|к|на)\s+кон(цу|ец)\s+недел/.test(text) || /на этой неделе/.test(text)) return isoDate(addDays(startOfWeek(baseDate), 6));
  if (/на\s+следующей\s+неделе|следующую\s+неделю/.test(text)) return isoDate(addDays(startOfWeek(addDays(baseDate, 7)), 6));
  if (/на выходных|в выходные/.test(text)) return isoDate(addDays(startOfWeek(baseDate), 6));

  const dateMatch = text.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (dateMatch) {
    const year = dateMatch[3] ? normalizeYear(dateMatch[3]) : baseDate.getFullYear();
    return isoDate(new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[1])));
  }

  const monthMatch = text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/);
  if (monthMatch) {
    const date = new Date(baseDate.getFullYear(), MONTHS[monthMatch[2]], Number(monthMatch[1]));
    if (date < startOfDay(baseDate)) date.setFullYear(date.getFullYear() + 1);
    return isoDate(date);
  }

  const nextWeek = /следующ(ий|ую|ем)\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)/.test(text);
  const weekday = parseWeekday(text);
  if (weekday !== null) {
    const current = (baseDate.getDay() + 6) % 7;
    let diff = weekday - current;
    if (diff < 0 || nextWeek) diff += 7;
    return isoDate(addDays(baseDate, diff));
  }
  return null;
}

function normalizeYear(y) {
  const num = Number(y);
  return num < 100 ? 2000 + num : num;
}

function parseWeekday(text) {
  const forms = [
    ['понедельник', 'понедельника'], ['вторник', 'вторника'], ['среду', 'среды', 'среда'], ['четверг', 'четверга'],
    ['пятницу', 'пятницы', 'пятница'], ['субботу', 'субботы', 'суббота'], ['воскресенье', 'воскресенья']
  ];
  for (let i = 0; i < forms.length; i++) {
    if (forms[i].some(form => new RegExp(`\\b${form}\\b`).test(text))) return i;
  }
  return null;
}

function parsePriority(text, deadline) {
  let priority = 2;
  if (/(срочно|важно|дедлайн|горит|обязательно|критично|приоритетно)/.test(text)) priority = 3;
  const daysLeft = Math.ceil((new Date(deadline) - startOfDay(new Date())) / 86400000);
  if (daysLeft <= 1) priority = Math.max(priority, 3);
  if (/(когда-нибудь|не срочно|если успею|по возможности)/.test(text)) priority = 1;
  return priority;
}

function parseTaskEnergy(text) {
  if (/(сложно|креатив|концепц|сценар|стратег|презентац|исслед|монтаж|дизайн|разобраться|продумать)/.test(text)) return 3;
  if (/(ответить|купить|оплатить|позвонить|отправить|забрать|записаться)/.test(text)) return 1;
  return 2;
}

function parseCategory(text) {
  if (/(креатив|концепц|сценар|дизайн|клип|монтаж|музык|референс)/.test(text)) return 'творчество';
  if (/(клиент|работ|проект|презентац|договор|коммерч|таблиц|бриф|созвон|встреч)/.test(text)) return 'работа';
  if (/(здоров|сон|спорт|врач|отдых|терап)/.test(text)) return 'самочувствие';
  return 'общее';
}

function parseTimeWindow(text) {
  if (/(только\s+утром|утром|с утра|первая\s+половина\s+дня|до\s+обеда)/.test(text)) return 'morning';
  if (/(после\s+обеда|дн[её]м|днем|вторая\s+половина\s+дня)/.test(text)) return 'afternoon';
  if (/(вечером|ближе\s+к\s+вечеру|после\s+работы|в\s+конце\s+дня)/.test(text)) return 'evening';
  return null;
}

function parseExactTime(text) {
  const explicit = text.match(/(?:в|к)\s*(\d{1,2})(?::|\.)?(\d{2})?\b/);
  if (!explicit) return null;
  const hour = Number(explicit[1]);
  const mins = explicit[2] ? Number(explicit[2]) : 0;
  if (hour > 23 || mins > 59) return null;
  return hour * 60 + mins;
}

function parseTimeBounds(text) {
  let notBefore = null;
  let notAfter = null;
  const afterMatch = text.match(/после\s*(\d{1,2})(?::|\.)?(\d{2})?\b/);
  if (afterMatch) notBefore = Number(afterMatch[1]) * 60 + Number(afterMatch[2] || 0);
  const beforeMatch = text.match(/до\s*(\d{1,2})(?::|\.)?(\d{2})?\b/);
  if (beforeMatch && !(beforeMatch[0].includes('пятниц') || beforeMatch[0].includes('четверг'))) {
    const hour = Number(beforeMatch[1]);
    if (hour <= 23) notAfter = hour * 60 + Number(beforeMatch[2] || 0);
  }
  if (/не\s*ставь\s*вечером|не\s*вечером/.test(text)) notAfter = notAfter === null ? 17 * 60 : Math.min(notAfter, 17 * 60);
  if (/не\s*раньше\s*обеда/.test(text)) notBefore = Math.max(notBefore ?? 0, 13 * 60);
  return { notBefore, notAfter };
}

function parseDayPreference(text) {
  if (/на выходных|в выходные/.test(text)) return 'weekend';
  if (/в будни|по будням/.test(text)) return 'weekday';
  return null;
}

function parseSpreadDays(text) {
  const match = text.match(/(?:разбей|растяни|раскидай)\s+на\s+(\d+)\s+(?:дня|дней|день)/);
  if (match) return Math.max(1, Number(match[1]));
  return 1;
}

function cleanupTitle(text) {
  let title = text
    .replace(/\b(сегодня|завтра|послезавтра|на этой неделе|на выходных|в выходные)\b/gi, '')
    .replace(/\b(до|к|на)\s+(понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|конца недели|следующий\s+понедельник|следующую\s+среду|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\b/gi, '')
    .replace(/\bв\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\b/gi, '')
    .replace(/\b(утром|вечером|днем|днём|после\s+обеда|ночью|только\s+утром|первая\s+половина\s+дня|вторая\s+половина\s+дня|до\s+обеда|после\s+работы|в\s+конце\s+дня|ближе\s+к\s+вечеру)\b/gi, '')
    .replace(/\b(не\s*ставь\s*вечером|не\s*вечером|в\s*будни|по\s*будням)\b/gi, '')
    .replace(/\b\d+(?::|\.)\d{2}\b/gi, '')
    .replace(/\b(в|к|после|до)\s*\d{1,2}(?::|\.)?\d{0,2}\b/gi, '')
    .replace(/\b\d+\s*(минут|минуты|мин|часа|часов|ч)\b/gi, '')
    .replace(/\b(полтора|полторы|полчаса|четверть\s+часа)\b/gi, '')
    .replace(/\b(срочно|важно|не\s*срочно|если\s*успею|по\s*возможности)\b/gi, '')
    .replace(/\b(разбей|растяни|раскидай)\s+на\s+\d+\s+(дня|дней|день)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-—,\s]+|[-—,\s]+$/g, '')
    .trim();
  if (!title) return text.trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function dailyCapacityMinutes(wellbeing, date) {
  const isWeekend = [0, 6].includes(new Date(date).getDay());
  let hours = 3 + wellbeing.energy * 0.75 + wellbeing.sleep * 0.35 - wellbeing.stress * 0.55;
  if (isWeekend) hours -= 0.75;
  hours = Math.max(1.5, Math.min(7.5, hours));
  return Math.round(hours * 60 / 15) * 15;
}

function buildSchedule(tasks, weekStart, wellbeing) {
  const weekDates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i)));
  const buckets = Object.fromEntries(weekDates.map(date => [date, { used: 0, occupied: [] }]));
  const schedule = [];
  const pending = tasks.filter(t => t.status !== 'done');
  const fixedTasks = pending
    .filter(t => t.fixedTime !== null)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline) || a.fixedTime - b.fixedTime);
  const flexibleTasks = pending
    .filter(t => t.fixedTime === null)
    .sort((a, b) => b.priority - a.priority || new Date(a.deadline) - new Date(b.deadline) || b.energy - a.energy);

  fixedTasks.forEach(task => {
    const manualDate = state.manual?.taskDates?.[task.id];
    const targetDate = manualDate && buckets[manualDate] ? manualDate : task.deadline;
    if (!buckets[targetDate]) return;
    const bucket = buckets[targetDate];
    const chunk = task.durationMin;
    const startMin = clampTime(task.fixedTime, timeToMinutes(state.settings.dayStart), timeToMinutes(state.settings.dayEnd) - 15);
    const endMin = startMin + chunk;
    schedule.push({ taskId: task.id, date: targetDate, startMin, endMin, chunkMin: chunk, fixed: true });
    bucket.occupied.push({ startMin, endMin });
    bucket.used += chunk;
    sortOccupied(bucket.occupied);
  });

  for (const task of flexibleTasks) {
    let remaining = task.durationMin;
    const chunkMaxBase = task.energy === 3 ? 90 : 120;
    const chunkMax = task.spreadDays > 1 ? Math.min(chunkMaxBase, Math.ceil(task.durationMin / task.spreadDays / 15) * 15) : chunkMaxBase;
    const dates = candidateDatesForTask(task, weekDates);

    for (const date of dates) {
      if (remaining <= 0) break;
      const bucket = buckets[date];
      if (!bucket) continue;
      const cap = dailyCapacityMinutes(wellbeing, date);
      if (bucket.used >= cap + 15) continue;

      let { start, end } = resolveWindowForTask(task, wellbeing);
      if (task.notBefore !== null) start = Math.max(start, task.notBefore);
      if (task.notAfter !== null) end = Math.min(end, task.notAfter);
      if (end - start < 15) continue;

      const availableByCapacity = Math.max(0, cap - bucket.used);
      const chunk = Math.min(remaining, availableByCapacity || remaining, chunkMax);
      if (chunk < 15) continue;

      const slot = findFreeSlot(bucket.occupied, start, end, chunk, chunk >= state.settings.breakAfterMinutes ? 20 : 10);
      if (!slot) continue;

      schedule.push({ taskId: task.id, date, startMin: slot.startMin, endMin: slot.endMin, chunkMin: slot.endMin - slot.startMin });
      bucket.occupied.push(slot);
      bucket.used += slot.endMin - slot.startMin;
      sortOccupied(bucket.occupied);
      remaining -= slot.endMin - slot.startMin;
    }

    if (remaining > 0) {
      const lastDate = dates[dates.length - 1] || weekDates[6];
      const bucket = buckets[lastDate] || { occupied: [], used: 0 };
      let { start, end } = resolveWindowForTask(task, wellbeing);
      if (task.notBefore !== null) start = Math.max(start, task.notBefore);
      if (task.notAfter !== null) end = Math.min(end, task.notAfter);
      const fallbackStart = findLastEnd(bucket.occupied, start) || start;
      const startMin = Math.min(fallbackStart, end - 15);
      schedule.push({ taskId: task.id, date: lastDate, startMin, endMin: startMin + remaining, chunkMin: remaining, overflow: true });
      bucket.occupied.push({ startMin, endMin: startMin + remaining });
      bucket.used += remaining;
      if (buckets[lastDate]) sortOccupied(buckets[lastDate].occupied);
    }
  }

  return schedule.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

function clampTime(value, min, max) { return Math.max(min, Math.min(max, value)); }
function sortOccupied(occupied) { occupied.sort((a, b) => a.startMin - b.startMin); }
function findLastEnd(occupied, fallback) {
  if (!occupied.length) return fallback;
  return Math.max(...occupied.map(o => o.endMin + 10));
}

function resolveWindowForTask(task, wellbeing) {
  const defaultStart = timeToMinutes(state.settings.dayStart);
  const defaultEnd = timeToMinutes(state.settings.dayEnd);
  let window = WINDOW_PRESETS.flexible;
  if (task.preferredWindow) window = WINDOW_PRESETS[task.preferredWindow];
  if (!task.preferredWindow && wellbeing.energy <= 2 && task.energy === 3) window = WINDOW_PRESETS.morning;
  if (!task.preferredWindow && wellbeing.stress >= 4 && task.energy >= 2) window = { start: defaultStart, end: 17 * 60, label: 'до вечера' };
  return { start: Math.max(defaultStart, window.start), end: Math.min(defaultEnd, window.end) };
}

function candidateDatesForTask(task, weekDates) {
  const manualDate = state.manual?.taskDates?.[task.id];
  if (manualDate && weekDates.includes(manualDate)) return [manualDate];

  let dates = weekDates.filter(date => date <= task.deadline);
  if (!dates.length && weekDates.includes(task.deadline)) dates = [task.deadline];
  if (!dates.length) dates = [...weekDates];
  if (task.dayPreference === 'weekend') {
    const weekends = dates.filter(d => [0, 6].includes(new Date(d).getDay()));
    return weekends.length ? weekends.concat(dates.filter(d => !weekends.includes(d))) : dates;
  }
  if (task.dayPreference === 'weekday') {
    const weekdays = dates.filter(d => ![0, 6].includes(new Date(d).getDay()));
    return weekdays.length ? weekdays.concat(dates.filter(d => !weekdays.includes(d))) : dates;
  }
  return dates;
}

function findFreeSlot(occupied, start, end, duration, breakGap = 10) {
  const items = occupied.slice().sort((a, b) => a.startMin - b.startMin);
  let cursor = start;
  for (const item of items) {
    if (cursor + duration <= item.startMin) return { startMin: cursor, endMin: cursor + duration };
    if (cursor < item.endMin + breakGap) cursor = item.endMin + breakGap;
    if (cursor + duration > end) break;
  }
  if (cursor + duration <= end) return { startMin: cursor, endMin: cursor + duration };
  return null;
}

function isTaskDone(taskId) {
  return state.tasks.find(t => t.id === taskId)?.status === 'done';
}

function render() {
  applyTheme();
  $('energyRange').value = state.wellbeing.energy;
  $('stressRange').value = state.wellbeing.stress;
  $('sleepRange').value = state.wellbeing.sleep;
  $('energyValue').textContent = state.wellbeing.energy;
  $('stressValue').textContent = state.wellbeing.stress;
  $('sleepValue').textContent = state.wellbeing.sleep;
  if (!state.lastSchedule.length && state.tasks.length) state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  renderCapacity();
  renderToday();
  renderPlanner();
  renderPushStatus(false);
  renderWeek();
  renderTasks();
  renderHelperSelect();
}

function renderCapacity() {
  const todayCap = dailyCapacityMinutes(state.wellbeing, new Date());
  const mood = state.wellbeing.energy <= 2 || state.wellbeing.stress >= 4
    ? 'режим разгрузки: сложные задачи ставим раньше и оставляем больше воздуха'
    : state.wellbeing.energy >= 4 && state.wellbeing.stress <= 2
      ? 'ресурсный режим: можно планировать глубокую работу'
      : 'сбалансированный режим: держим баланс задач и пауз';
  $('capacityCard').innerHTML = `Полезная ёмкость сегодня: <strong>${Math.round(todayCap / 60 * 10) / 10} ч</strong><br>${mood}`;
}

function renderToday() {
  const today = isoDate(new Date());
  const items = state.lastSchedule
    .filter(item => item.date === today)
    .sort((a, b) => a.startMin - b.startMin);
  const used = items.reduce((sum, item) => sum + item.chunkMin, 0);
  const cap = dailyCapacityMinutes(state.wellbeing, new Date());
  const remaining = Math.max(0, cap - used);
  $('todaySummary').innerHTML = `
    <div class="today-stat"><span>Запланировано</span><strong>${Math.round(used / 60 * 10) / 10} ч</strong></div>
    <div class="today-stat"><span>Ёмкость</span><strong>${Math.round(cap / 60 * 10) / 10} ч</strong></div>
    <div class="today-stat"><span>Воздух</span><strong>${Math.round(remaining / 60 * 10) / 10} ч</strong></div>
  `;

  const list = $('todayList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty-state">На сегодня ничего не стоит. Можно нажать “Собрать день” или перетащить задачи в сегодняшний день.</div>';
    return;
  }

  items.forEach(item => {
    const task = state.tasks.find(t => t.id === item.taskId);
    if (!task) return;
    const card = document.createElement('article');
    card.className = `today-card ${item.overflow ? 'overflow' : ''}`;
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.addEventListener('dragstart', handleDragStart);
    card.innerHTML = `
      <div class="today-time">${minutesToTime(item.startMin)}–${minutesToTime(item.endMin)}</div>
      <div class="today-body">
        <h3>${safeText(task.title)}</h3>
        <p>${safeText(task.category)} · ${item.chunkMin} мин · дедлайн ${formatDate(task.deadline)}</p>
      </div>
      <div class="today-actions">
        <button class="tiny" data-action="done">Готово</button>
        <button class="tiny" data-action="tomorrow">Завтра</button>
        <button class="tiny" data-action="clear-manual">Авто</button>
      </div>
    `;
    card.querySelector('[data-action="done"]').addEventListener('click', () => toggleTask(task.id));
    card.querySelector('[data-action="tomorrow"]').addEventListener('click', () => moveTaskToDate(task.id, isoDate(addDays(new Date(), 1))));
    card.querySelector('[data-action="clear-manual"]').addEventListener('click', () => clearManualDate(task.id));
    list.appendChild(card);
  });
}

function handleDragStart(event) {
  const taskId = event.currentTarget.dataset.taskId;
  event.dataTransfer.setData('text/plain', taskId);
  event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drop-target');
  event.dataTransfer.dropEffect = 'move';
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove('drop-target');
}

function handleDropOnDay(event) {
  event.preventDefault();
  const column = event.currentTarget;
  column.classList.remove('drop-target');
  const taskId = event.dataTransfer.getData('text/plain');
  const date = column.dataset.date;
  if (!taskId || !date) return;
  moveTaskToDate(taskId, date);
}

function moveTaskToDate(taskId, date) {
  state.manual = state.manual || { taskDates: {} };
  state.manual.taskDates = state.manual.taskDates || {};
  state.manual.taskDates[taskId] = date;
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
}

function clearManualDate(taskId) {
  if (state.manual?.taskDates) delete state.manual.taskDates[taskId];
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
}


function analyzeWeek() {
  const weekDates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(currentWeekStart, i)));
  const today = isoDate(new Date());
  const rows = weekDates.map(date => {
    const items = state.lastSchedule.filter(item => item.date === date);
    const used = items.reduce((sum, item) => sum + item.chunkMin, 0);
    const cap = dailyCapacityMinutes(state.wellbeing, date);
    const heavy = items.filter(item => state.tasks.find(t => t.id === item.taskId)?.energy === 3).length;
    const overflow = items.filter(item => item.overflow).length;
    const late = items.filter(item => {
      const task = state.tasks.find(t => t.id === item.taskId);
      return task && item.date > task.deadline;
    }).length;
    return { date, items, used, cap, heavy, overflow, late, overBy: Math.max(0, used - cap) };
  });
  const activeTasks = state.tasks.filter(t => t.status !== 'done');
  const overdue = activeTasks.filter(t => t.deadline < today);
  const unscheduled = activeTasks.filter(task => !state.lastSchedule.some(item => item.taskId === task.id));
  const overloaded = rows.filter(row => row.used > row.cap);
  const heavyDays = rows.filter(row => row.heavy >= 3);
  const manualCount = Object.keys(state.manual?.taskDates || {}).length;
  const totalUsed = rows.reduce((sum, row) => sum + row.used, 0);
  const totalCap = rows.reduce((sum, row) => sum + row.cap, 0);
  return { rows, activeTasks, overdue, unscheduled, overloaded, heavyDays, manualCount, totalUsed, totalCap };
}

function renderPlanner() {
  const el = $('plannerOutput');
  if (!el) return;
  const a = analyzeWeek();
  if (!state.tasks.length) {
    el.innerHTML = '<div class="empty-state compact-empty">Добавь несколько задач — здесь появится разбор недели и предложения по разгрузке.</div>';
    return;
  }
  const issues = [];
  if (a.overdue.length) issues.push(`Просрочено: ${a.overdue.length} задач.`);
  if (a.overloaded.length) issues.push(`Перегружены дни: ${a.overloaded.map(row => `${formatDate(row.date)} +${Math.round(row.overBy / 60 * 10) / 10} ч`).join(', ')}.`);
  if (a.heavyDays.length) issues.push(`Много тяжёлых блоков в один день: ${a.heavyDays.map(row => formatDate(row.date)).join(', ')}.`);
  if (a.unscheduled.length) issues.push(`Не попали в расписание: ${a.unscheduled.length} задач.`);
  if (!issues.length) issues.push('Неделя выглядит устойчиво: критичного перегруза не вижу.');

  const loadPct = a.totalCap ? Math.round(a.totalUsed / a.totalCap * 100) : 0;
  const mode = state.wellbeing.energy <= 2 || state.wellbeing.stress >= 4 ? 'бережный режим' : loadPct > 85 ? 'плотный режим' : 'рабочий режим';
  const advice = buildPlannerAdvice(a, loadPct);
  el.innerHTML = `
    <div class="planner-meter">
      <span>Нагрузка недели</span>
      <strong>${Math.round(a.totalUsed / 60 * 10) / 10}/${Math.round(a.totalCap / 60 * 10) / 10} ч · ${loadPct}%</strong>
    </div>
    <div class="meter-track"><div class="meter-fill" style="width:${Math.min(100, loadPct)}%"></div></div>
    <p class="planner-mode">${safeText(mode)}</p>
    <ul class="planner-list">${issues.map(issue => `<li>${safeText(issue)}</li>`).join('')}</ul>
    <p class="planner-advice">${safeText(advice)}</p>
    ${a.manualCount ? `<p class="muted small">Ручных переносов: ${a.manualCount}. Кнопка «Сбросить переносы» вернёт авто-план.</p>` : ''}
  `;
}

function buildPlannerAdvice(a, loadPct) {
  if (a.overloaded.length) return 'Нажми «Разгрузить»: я попробую перенести гибкие и менее срочные задачи в свободные окна без потери дедлайнов.';
  if (a.overdue.length) return 'Сначала выбери просроченные задачи: часть нужно закрыть, часть — честно перенести новым дедлайном.';
  if (state.wellbeing.energy <= 2 || state.wellbeing.stress >= 4) return 'Сегодня лучше оставить только обязательное, а творческие задачи разбить короткими заходами.';
  if (loadPct > 85) return 'Неделя плотная. Я бы оставил минимум 1–2 часа буфера на непредвиденное.';
  return 'План сбалансирован. Можно работать по экрану «Сегодня» и отмечать завершённое.';
}

function applyReliefPlan() {
  const a = analyzeWeek();
  let moved = 0;
  state.manual = state.manual || { taskDates: {} };
  state.manual.taskDates = state.manual.taskDates || {};

  for (const row of a.overloaded) {
    let overBy = row.overBy;
    const movable = row.items
      .map(item => ({ item, task: state.tasks.find(t => t.id === item.taskId) }))
      .filter(x => x.task && x.task.fixedTime === null && x.task.priority < 3)
      .sort((x, y) => x.task.priority - y.task.priority || x.task.energy - y.task.energy || y.item.startMin - x.item.startMin);

    for (const { item, task } of movable) {
      if (overBy <= 0) break;
      const target = findReliefDate(task, row.date, item.chunkMin);
      if (!target) continue;
      state.manual.taskDates[task.id] = target;
      moved += 1;
      overBy -= item.chunkMin;
    }
  }

  if (!moved && (state.wellbeing.energy <= 2 || state.wellbeing.stress >= 4)) {
    moved += makeGentleToday(false);
  }

  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
  $('parseFeedback').textContent = moved ? `Разгрузил план: перенёс задач ${moved}.` : 'Не нашёл безопасных переносов: задачи либо срочные, либо фиксированные.';
}

function findReliefDate(task, fromDate, durationMin) {
  const weekDates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(currentWeekStart, i)));
  const fromIndex = weekDates.indexOf(fromDate);
  const candidates = weekDates.slice(Math.max(0, fromIndex + 1)).filter(date => date <= task.deadline || task.priority <= 1);
  for (const date of candidates) {
    const used = state.lastSchedule.filter(item => item.date === date).reduce((sum, item) => sum + item.chunkMin, 0);
    const cap = dailyCapacityMinutes(state.wellbeing, date);
    if (cap - used >= Math.min(durationMin, 60)) return date;
  }
  return null;
}

function makeGentleToday(shouldRender = true) {
  const today = isoDate(new Date());
  const tomorrow = isoDate(addDays(new Date(), 1));
  let moved = 0;
  state.manual = state.manual || { taskDates: {} };
  state.manual.taskDates = state.manual.taskDates || {};
  const items = state.lastSchedule.filter(item => item.date === today).sort((a, b) => b.startMin - a.startMin);
  for (const item of items) {
    const task = state.tasks.find(t => t.id === item.taskId);
    if (!task || task.fixedTime !== null || task.priority >= 3) continue;
    if (task.energy >= 2 || state.wellbeing.energy <= 2 || state.wellbeing.stress >= 4) {
      state.manual.taskDates[task.id] = tomorrow;
      moved += 1;
    }
    if (moved >= 3) break;
  }
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  if (shouldRender) {
    render();
    $('parseFeedback').textContent = moved ? `Сделал день щадящим: перенёс задач ${moved} на завтра.` : 'Сегодня уже достаточно щадящий: переносить нечего.';
  }
  return moved;
}

function clearAllManualDates() {
  state.manual = { taskDates: {} };
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
  $('parseFeedback').textContent = 'Ручные переносы сброшены, неделя снова собрана автоматически.';
}

function renderPushStatus(showAlert = true) {
  const el = $('pushStatus');
  if (!el) return;
  const checks = [
    { label: 'HTTPS или localhost', ok: window.isSecureContext || location.hostname === 'localhost' },
    { label: 'Service Worker', ok: 'serviceWorker' in navigator },
    { label: 'Notification API', ok: 'Notification' in window },
    { label: 'Push API', ok: 'PushManager' in window },
    { label: 'Открыто как приложение', ok: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true }
  ];
  const okCount = checks.filter(c => c.ok).length;
  el.innerHTML = `
    <div class="push-score">${okCount}/${checks.length}</div>
    <ul class="push-checks">${checks.map(c => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '•'} ${safeText(c.label)}</li>`).join('')}</ul>
    <p class="muted small">Локальные уведомления работают при открытом приложении. Для настоящих фоновых push нужно развернуть сервер из папки <code>push-server-example</code>.</p>
    ${state.settings.pushServerUrl ? `<p class="muted small">Подключён сервер: <code>${safeText(state.settings.pushServerUrl)}</code></p>` : ''}
  `;
  if (showAlert && okCount < checks.length) {
    console.info('FocusFlow push readiness:', checks);
  }
}


async function connectPushServer() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    alert('В этом браузере Push API недоступен.');
    return;
  }
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    alert('Для push нужен HTTPS. Локально можно тестировать через localhost.');
    return;
  }
  const defaultUrl = state.settings.pushServerUrl || 'https://your-focusflow-push-server.example.com';
  const serverUrl = prompt('URL push-сервера без слеша в конце', defaultUrl);
  if (!serverUrl) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('notifications denied');
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await fetch(`${serverUrl.replace(/\/$/, '')}/vapid-public-key`);
    const { publicKey } = await keyResponse.json();
    if (!publicKey) throw new Error('missing public key');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(publicKey)
    });
    const subResponse = await fetch(`${serverUrl.replace(/\/$/, '')}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    if (!subResponse.ok) throw new Error('subscribe failed');
    state.settings.pushServerUrl = serverUrl.replace(/\/$/, '');
    saveState();
    renderPushStatus(false);
    alert('Push-подписка подключена. Теперь сервер сможет отправлять фоновые уведомления.');
  } catch (error) {
    console.error(error);
    alert('Не получилось подключить push-сервер. Проверь HTTPS, VAPID-ключи и адрес сервера.');
  }
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function exportIcsCalendar() {
  const items = state.lastSchedule
    .map(item => ({ item, task: state.tasks.find(t => t.id === item.taskId) }))
    .filter(x => x.task && x.task.status !== 'done');
  if (!items.length) {
    alert('Нет запланированных задач для экспорта.');
    return;
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FocusFlow//PWA v0.4//RU', 'CALSCALE:GREGORIAN'];
  items.forEach(({ item, task }) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${task.id}-${item.date}-${item.startMin}@focusflow.local`);
    lines.push(`DTSTAMP:${icsStamp(new Date())}`);
    lines.push(`DTSTART:${icsLocal(item.date, item.startMin)}`);
    lines.push(`DTEND:${icsLocal(item.date, item.endMin)}`);
    lines.push(`SUMMARY:${icsEscape(task.title)}`);
    lines.push(`DESCRIPTION:${icsEscape(`FocusFlow · ${task.category} · дедлайн ${task.deadline}`)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focusflow-plan-${isoDate(new Date())}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function icsEscape(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsLocal(dateIso, minutes) {
  const clean = dateIso.replace(/-/g, '');
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${clean}T${h}${m}00`;
}

function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function renderWeek() {
  const end = addDays(currentWeekStart, 6);
  $('weekTitle').textContent = `${formatDate(currentWeekStart)} — ${formatDate(end)}`;
  const grid = $('weekGrid');
  grid.innerHTML = '';
  const tabs = $('weekDayTabs');
  if (tabs) tabs.innerHTML = '';
  const todayIso = isoDate(new Date());

  for (let i = 0; i < 7; i++) {
    const date = addDays(currentWeekStart, i);
    const dateIso = isoDate(date);
    const items = state.lastSchedule.filter(item => item.date === dateIso).sort((a, b) => a.startMin - b.startMin);
    const used = items.reduce((sum, item) => sum + item.chunkMin, 0);
    const cap = dailyCapacityMinutes(state.wellbeing, date);

    if (tabs) {
      const tab = document.createElement('a');
      tab.href = `#day-${dateIso}`;
      tab.className = `week-day-tab ${dateIso === todayIso ? 'today' : ''} ${used > cap ? 'over' : ''}`;
      tab.innerHTML = `<strong>${DAY_NAMES[i]}</strong><span>${formatDate(date)}</span><small>${Math.round(used / 60 * 10) / 10} ч</small>`;
      tabs.appendChild(tab);
    }

    const column = document.createElement('section');
    column.id = `day-${dateIso}`;
    column.className = `day-column ${dateIso === todayIso ? 'today' : ''}`;
    column.dataset.date = dateIso;
    column.addEventListener('dragover', handleDragOver);
    column.addEventListener('dragleave', handleDragLeave);
    column.addEventListener('drop', handleDropOnDay);
    column.innerHTML = `
      <div class="day-head">
        <div><div class="day-name">${DAY_NAMES[i]}</div><div class="day-date">${formatDate(date)}</div></div>
        <div class="load-pill ${used > cap ? 'over' : ''}">${Math.round(used / 60 * 10) / 10}/${Math.round(cap / 60 * 10) / 10} ч</div>
      </div>
    `;
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Свободное окно';
      column.appendChild(empty);
    } else {
      items.forEach(item => column.appendChild(renderScheduledItem(item)));
    }
    grid.appendChild(column);
  }
}

function renderScheduledItem(item) {
  const task = state.tasks.find(t => t.id === item.taskId);
  const card = document.createElement('div');
  if (!task) return card;
  card.className = `scheduled-card ${task.status === 'done' ? 'done' : ''}`;
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.addEventListener('dragstart', handleDragStart);
  const tags = [`${item.chunkMin} мин`, task.category, `энергия ${task.energy}/3`];
  if (state.manual?.taskDates?.[task.id]) tags.push('перенесено');
  if (task.fixedTime !== null || item.fixed) tags.push('фиксировано');
  if (task.preferredWindow) tags.push(WINDOW_PRESETS[task.preferredWindow].label);
  if (item.date > task.deadline) tags.push('после дедлайна');
  if (item.overflow) tags.push('перегруз');
  card.innerHTML = `
    <div class="scheduled-time">${minutesToTime(item.startMin)}–${minutesToTime(item.endMin)}</div>
    <div class="scheduled-title">${safeText(task.title)}</div>
    <div class="scheduled-tags">${tags.map(tag => `<span class="tag ${['перегруз','после дедлайна'].includes(tag) ? 'danger' : tag === 'перенесено' ? 'warn' : ''}">${safeText(tag)}</span>`).join('')}</div>
  `;
  card.addEventListener('click', () => toggleTask(task.id));
  return card;
}

function renderTasks() {
  const list = $('taskList');
  list.innerHTML = '';
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty-state">Пока задач нет. Наговори или введи первую пачку мыслей сверху.</div>';
    return;
  }
  const template = $('taskTemplate');
  state.tasks
    .slice()
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || new Date(a.deadline) - new Date(b.deadline))
    .forEach(task => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector('.task-card');
      card.classList.toggle('done', task.status === 'done');
      card.draggable = true;
      card.dataset.taskId = task.id;
      card.addEventListener('dragstart', handleDragStart);
      node.querySelector('.task-title').textContent = task.title;
      const timeMeta = [];
      if (task.fixedTime !== null) timeMeta.push(`в ${minutesToTime(task.fixedTime)}`);
      else if (task.preferredWindow) timeMeta.push(WINDOW_PRESETS[task.preferredWindow].label);
      if (task.notBefore !== null) timeMeta.push(`после ${minutesToTime(task.notBefore)}`);
      if (task.notAfter !== null) timeMeta.push(`до ${minutesToTime(task.notAfter)}`);
      node.querySelector('.task-meta').textContent = `${task.durationMin} мин · дедлайн ${formatDate(task.deadline)} · приоритет ${task.priority}/3 · ${task.category}${timeMeta.length ? ' · ' + timeMeta.join(', ') : ''}`;
      node.querySelector('.task-notes').textContent = task.notes || '';
      const checkbox = node.querySelector('.task-done');
      checkbox.checked = task.status === 'done';
      checkbox.addEventListener('change', () => toggleTask(task.id));
      node.querySelector('.task-delete').addEventListener('click', () => deleteTask(task.id));
      node.querySelector('.task-edit').addEventListener('click', () => editTask(task.id));
      list.appendChild(node);
    });
}

function renderHelperSelect() {
  const select = $('helperTaskSelect');
  select.innerHTML = '';
  const tasks = state.tasks.filter(t => t.status !== 'done');
  if (!tasks.length) {
    select.innerHTML = '<option>Нет активных задач</option>';
    $('helpBtn').disabled = true;
    return;
  }
  $('helpBtn').disabled = false;
  tasks.forEach(task => {
    const opt = document.createElement('option');
    opt.value = task.id;
    opt.textContent = task.title;
    select.appendChild(opt);
  });
}

function renderHelp() {
  const task = state.tasks.find(t => t.id === $('helperTaskSelect').value);
  if (!task) return;
  const isCreative = task.category === 'творчество';
  const steps = isCreative ? [
    'Сформулируй итог одним предложением: что должно получиться и по каким признакам это уже “достаточно хорошо”.',
    'Собери 3–5 референсов или опорных идей без оценки — сейчас задача только набрать материал.',
    'Сделай грубый черновик за 25 минут. Разреши ему быть сырым: это помогает начать.',
    'Выдели один сильный элемент и усили его. Не пытайся улучшить всё сразу.',
    'Зафиксируй следующий микро-шаг: что открыть, кому написать, что проверить после паузы.'
  ] : [
    'Определи ожидаемый результат и кому он нужен.',
    'Разбей задачу на первый видимый шаг на 15–30 минут.',
    'Собери вводные: файлы, контакты, ограничения, вопросы.',
    'Сделай черновой результат, даже если он пока неполный.',
    'Проверь дедлайн и реши: что можно сократить, делегировать или перенести.'
  ];
  $('helperOutput').innerHTML = `
    <p><strong>${safeText(task.title)}</strong></p>
    <p>Режим: ${task.energy === 3 ? 'глубокая работа — лучше выделить тихое ресурсное окно' : 'обычная задача — можно делать коротким блоком'}.</p>
    <ol>${steps.map(step => `<li>${safeText(step)}</li>`).join('')}</ol>
  `;
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.status = task.status === 'done' ? 'pending' : 'done';
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (state.manual?.taskDates) delete state.manual.taskDates[id];
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
}

function editTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const title = prompt('Название задачи', task.title);
  if (title === null) return;
  const duration = prompt('Длительность в минутах', task.durationMin);
  if (duration === null) return;
  const deadline = prompt('Дедлайн YYYY-MM-DD', task.deadline);
  if (deadline === null) return;
  const fixedTime = prompt('Фиксированное время HH:MM (можно оставить пустым)', task.fixedTime !== null ? minutesToTime(task.fixedTime) : '');
  if (fixedTime === null) return;
  task.title = title.trim() || task.title;
  task.durationMin = Math.max(15, Number(duration) || task.durationMin);
  task.deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : task.deadline;
  task.fixedTime = /^\d{2}:\d{2}$/.test(fixedTime) ? timeToMinutes(fixedTime) : null;
  state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
  saveState();
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focusflow-export-${isoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.tasks)) throw new Error('bad format');
      state = { ...state, ...imported };
      state.lastSchedule = buildSchedule(state.tasks, currentWeekStart, state.wellbeing);
      saveState();
      render();
    } catch {
      alert('Не получилось импортировать файл.');
    }
  };
  reader.readAsText(file);
}

init();
