const API_URL = 'https://script.google.com/macros/s/AKfycbx1UBMAs__SrTlId7s07aF0T8kowuGaSorAuuGRzsNV0PUvG_HacYFHedw7RGrTA_o6/exec?api=1';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const TOKEN_KEY = 'reminder.token';
const NAME_KEY = 'reminder.name';

const $ = (id) => document.getElementById(id);

// 無痕模式或封鎖網站資料時 localStorage 會丟例外，此時退化成每次都要登入
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
  remove(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
};

let token = store.get(TOKEN_KEY);
let reminders = [];
let currentStatus = '待發送';

async function api(action, data = {}) {
  // 用 text/plain 送出，避免跨網域預檢請求（Apps Script 不支援）
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, ...data }),
  });
  const json = await res.json();
  if (json.relogin) {
    logoutLocal();
    throw new Error(json.error);
  }
  return json;
}

function showView(name) {
  $('login-view').hidden = name !== 'login';
  $('app-view').hidden = name !== 'app';
}

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

function logoutLocal() {
  token = null;
  store.remove(TOKEN_KEY);
  showView('login');
  setTimeout(() => $('password').focus(), 50);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  const err = $('login-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = '登入中…';
  try {
    const res = await api('login', { password: $('password').value });
    if (!res.ok) {
      err.textContent = res.error;
      return;
    }
    token = res.token;
    store.set(TOKEN_KEY, token);
    store.set(NAME_KEY, res.name);
    $('password').value = '';
    enterApp(res.name);
  } catch (ex) {
    err.textContent = '連線失敗，請檢查網路後再試';
  } finally {
    btn.disabled = false;
    btn.textContent = '登入';
  }
});

$('logout-btn').addEventListener('click', async () => {
  try { await api('logout'); } catch (e) { /* 本機登出即可 */ }
  logoutLocal();
});

$('refresh-btn').addEventListener('click', () => loadReminders(true));

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentStatus = tab.dataset.status;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    renderList();
  });
});

// ---- 語音對話 ----
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = {
  active: false,
  recog: null,
  history: [],
  busy: false,
};

function setMicState(state) {
  const wrap = document.querySelector('.mic-wrap');
  wrap.classList.toggle('active', state !== 'idle');
  wrap.classList.toggle('thinking', state === 'thinking');
  wrap.classList.toggle('speaking', state === 'speaking');
  $('mic-btn').setAttribute('aria-pressed', String(state !== 'idle'));
  $('mic-btn').setAttribute('aria-label', state === 'idle' ? '開始對話' : '結束對話');
  $('mic-status').textContent = {
    idle: '',
    listening: '我在聽，請說…',
    thinking: '思考中…',
    speaking: '',
  }[state];
}

function addBubble(kind, text) {
  const el = document.createElement('div');
  el.className = 'bubble ' + kind;
  el.textContent = text;
  const chat = $('chat');
  chat.append(el);
  // 只留最近幾則，避免把提醒清單擠到很下面
  while (chat.children.length > 8) chat.firstElementChild.remove();
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return el;
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'zh-TW') || voices.find((v) => v.lang.startsWith('zh')) || null;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      resolve();
    };
    // Safari 與 Chrome 有時不觸發 onend（例如手機靜音、語音被系統擋下），逾時就繼續，避免對話卡住
    const guard = setTimeout(done, Math.max(4000, text.length * 350));

    // 在 Safari 上先 cancel 再立刻 speak，常會把這句一起取消，所以只在真的有聲音時才清空
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    u.rate = 1.05;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.resume();
    speechSynthesis.speak(u);
  });
}

function listen() {
  if (!voice.active || !SpeechRecognition) return;
  const recog = new SpeechRecognition();
  voice.recog = recog;
  recog.lang = 'zh-TW';
  recog.interimResults = true;
  recog.continuous = false;
  recog.maxAlternatives = 1;

  let finalText = '';
  let interimEl = null;
  setMicState('listening');

  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const shown = (finalText + interim).trim();
    if (!shown) return;
    if (!interimEl) interimEl = addBubble('user interim', shown);
    else interimEl.textContent = shown;
  };

  recog.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopConversation();
      toast('沒有麥克風權限，請在瀏覽器設定允許使用麥克風，或改用打字');
    }
  };

  recog.onend = () => {
    if (voice.recog !== recog) return;
    voice.recog = null;
    const text = finalText.trim();
    if (interimEl) {
      if (text) interimEl.classList.remove('interim');
      else interimEl.remove();
    }
    if (!voice.active) return;
    // 一段時間沒說話瀏覽器會自動停止收音，對話還沒結束就重新開始聽
    if (text) sendMessage(text, { fromVoice: true });
    else listen();
  };

  try {
    recog.start();
  } catch (e) {
    setTimeout(listen, 300);
  }
}

async function sendMessage(text, { fromVoice = false } = {}) {
  if (voice.busy || !text) return;
  voice.busy = true;
  $('text-form').querySelector('button').disabled = true;
  if (!fromVoice) addBubble('user', text);
  voice.history.push({ role: 'user', text });
  setMicState('thinking');

  let res;
  try {
    res = await api('chat', { messages: voice.history });
  } catch (e) {
    res = { ok: false, error: e.message === '請重新登入' ? e.message : '連線失敗，請檢查網路' };
  }
  voice.busy = false;
  $('text-form').querySelector('button').disabled = false;

  const reply = res.ok ? res.reply : res.error;
  addBubble('ai', reply);

  if (res.ok) {
    let remembered = reply;
    if (res.created && res.created.length) {
      remembered += '\n[已建立]';
      addBubble('done', '已建立 ' + res.created.length + ' 則提醒');
      loadReminders();
    }
    voice.history.push({ role: 'assistant', text: remembered });
  } else {
    // 失敗的這一句不留在對話裡，讓使用者重說一次
    voice.history.pop();
  }

  if (voice.active) {
    setMicState('speaking');
    await speak(reply);
    if (res.ok && res.end) {
      stopConversation();
      return;
    }
    // 等語音完全播完再收音，避免把自己的聲音錄進去
    setTimeout(listen, 300);
  } else {
    setMicState('idle');
  }
}

async function startConversation() {
  voice.active = true;
  voice.history = [];
  $('chat').replaceChildren();
  const greeting = '嗨，' + ($('owner-name').textContent || 'Jeff') + '，有什麼我可以幫忙的？';
  addBubble('ai', greeting);

  if (!SpeechRecognition) {
    voice.active = false;
    setMicState('idle');
    $('mic-status').textContent = '這個瀏覽器不支援語音辨識，請用下方打字';
    $('text-input').focus();
    return;
  }

  setMicState('speaking');
  await speak(greeting);
  if (voice.active) setTimeout(listen, 300);
}

function stopConversation() {
  voice.active = false;
  const r = voice.recog;
  voice.recog = null;
  if (r) { try { r.abort(); } catch (e) { /* 已停止 */ } }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!voice.busy) setMicState('idle');
}

$('mic-btn').addEventListener('click', () => {
  if (voice.active) stopConversation();
  else startConversation();
});

$('text-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  // 打字時若正在收音，先停下來避免重複送出
  if (voice.recog) {
    const r = voice.recog;
    voice.recog = null;
    try { r.abort(); } catch (err) { /* 已停止 */ }
  }
  sendMessage(text);
});

if ('speechSynthesis' in window) {
  // 部分瀏覽器的語音清單是非同步載入，先觸發一次
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

function enterApp(name) {
  $('owner-name').textContent = name || 'Jeff';
  showView('app');
  loadReminders();
}

async function loadReminders(manual) {
  const btn = $('refresh-btn');
  btn.classList.add('spin');
  try {
    const res = await api('reminders');
    if (res.ok) {
      reminders = res.reminders;
      renderList();
      if (manual) toast('已更新');
    }
  } catch (e) {
    if (token) toast('讀取失敗，請稍後再試');
  } finally {
    btn.classList.remove('spin');
  }
}

const dateParts = new Intl.DateTimeFormat('zh-TW', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric', weekday: 'narrow' });
const dateFmt = {
  format(d) {
    const p = Object.fromEntries(dateParts.formatToParts(d).map((x) => [x.type, x.value]));
    return p.month + '/' + p.day + ' 週' + p.weekday;
  },
};
const timeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });

function renderList() {
  const counts = { '待發送': 0, '已送出': 0, '失敗': 0 };
  reminders.forEach((r) => { if (r.status in counts) counts[r.status]++; });
  document.querySelectorAll('.tab').forEach((t) => {
    t.querySelector('.count').textContent = counts[t.dataset.status] || '';
  });

  const items = reminders
    .filter((r) => r.status === currentStatus)
    .sort((a, b) => {
      const ta = Date.parse(a.sendAt) || 0;
      const tb = Date.parse(b.sendAt) || 0;
      // 待發送依時間先後，其他依最近的在前
      return currentStatus === '待發送' ? ta - tb : tb - ta;
    });

  const list = $('reminder-list');
  list.replaceChildren(...items.map(renderItem));

  const empty = $('list-empty');
  empty.hidden = items.length > 0;
  empty.textContent = {
    '待發送': '目前沒有待發送的提醒',
    '已送出': '最近 7 天沒有送出的提醒',
    '失敗': '沒有發送失敗的提醒',
  }[currentStatus];
}

function renderItem(r) {
  const li = document.createElement('li');
  li.className = 'item';
  const when = r.sendAt ? new Date(r.sendAt) : null;

  const whenEl = document.createElement('div');
  whenEl.className = 'when';
  whenEl.innerHTML = '<div class="time"></div><div class="date"></div>';
  whenEl.querySelector('.time').textContent = when ? timeFmt.format(when) : '--:--';
  whenEl.querySelector('.date').textContent = when ? dateFmt.format(when) : '時間有誤';

  const body = document.createElement('div');
  body.className = 'body';
  const content = document.createElement('p');
  content.className = 'content';
  content.textContent = r.content;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = r.target;
  meta.append(chip);
  if (r.note) {
    const note = document.createElement('span');
    note.textContent = r.note;
    if (r.status === '失敗') note.className = 'note-fail';
    meta.append(note);
  }
  body.append(content, meta);

  li.append(whenEl, body);
  return li;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 不影響使用 */ });
}

if (token) {
  enterApp(store.get(NAME_KEY));
} else {
  showView('login');
}
