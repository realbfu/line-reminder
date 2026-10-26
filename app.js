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

let currentView = 'reminders';
let targets = [];
let currentBot = 'all';

$('refresh-btn').addEventListener('click', () => {
  loadBots();
  if (currentView === 'friends') loadTargets(true);
  else loadReminders(true);
});

document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $('reminders-view').hidden = currentView !== 'reminders';
    $('friends-view').hidden = currentView !== 'friends';
    if (currentView === 'friends') loadTargets();
  });
});

async function loadBots() {
  try {
    const res = await api('bots');
    if (res.ok) renderQuota(res.bots);
  } catch (e) { /* 額度只是參考資訊，讀不到不影響使用 */ }
}

function renderQuota(bots) {
  $('quota').replaceChildren(...bots.map((b) => {
    const card = document.createElement('div');
    card.className = 'quota-card';
    const name = document.createElement('span');
    name.className = 'quota-name';
    name.textContent = b.name;
    const num = document.createElement('div');
    num.className = 'quota-num';
    if (b.used === null) {
      num.textContent = '查詢失敗';
      card.append(name, num);
      return card;
    }
    num.textContent = b.used;
    if (b.limit) {
      const small = document.createElement('small');
      small.textContent = ' / ' + b.limit + ' 則';
      num.append(small);
    }
    card.append(name, num);
    if (b.limit) {
      const ratio = Math.min(1, b.used / b.limit);
      const bar = document.createElement('div');
      bar.className = 'bar' + (ratio >= 1 ? ' full' : ratio >= 0.8 ? ' warn' : '');
      const fill = document.createElement('span');
      fill.style.width = (ratio * 100).toFixed(1) + '%';
      bar.append(fill);
      card.append(bar);
    }
    return card;
  }));
}

async function loadTargets(manual) {
  const btn = $('refresh-btn');
  btn.classList.add('spin');
  try {
    const res = await api('targets');
    if (res.ok) {
      targets = res.targets;
      renderFriends();
      if (manual) toast('已更新');
    }
  } catch (e) {
    if (token) toast('讀取失敗，請稍後再試');
  } finally {
    btn.classList.remove('spin');
  }
}

function renderFriends() {
  // 依機器人分組的篩選按鈕，Discord 頻道另外一組
  const groups = [];
  targets.forEach((t) => {
    const key = t.bot || 'discord';
    if (!groups.some((g) => g.key === key)) groups.push({ key, name: t.botName });
  });
  if (currentBot !== 'all' && !groups.some((g) => g.key === currentBot)) currentBot = 'all';
  const filters = [{ key: 'all', name: '全部' }, ...groups].map((g) => {
    const b = document.createElement('button');
    b.className = 'filter-btn';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(g.key === currentBot));
    const count = g.key === 'all' ? targets.length : targets.filter((t) => (t.bot || 'discord') === g.key).length;
    b.textContent = g.name + ' ' + count;
    b.addEventListener('click', () => { currentBot = g.key; renderFriends(); });
    return b;
  });
  $('bot-filter').replaceChildren(...filters);

  const items = targets
    .filter((t) => currentBot === 'all' || (t.bot || 'discord') === currentBot)
    .sort((a, b) => (b.nickname ? 1 : 0) - (a.nickname ? 1 : 0));
  $('friend-list').replaceChildren(...items.map(renderFriend));
  $('friend-empty').hidden = items.length > 0;
  $('friend-empty').textContent = '還沒有好友或群組';
}

const joinFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });

function renderFriend(t) {
  const li = document.createElement('li');
  li.className = 'friend';

  let avatar;
  if (t.picture) {
    avatar = document.createElement('img');
    avatar.src = t.picture;
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.referrerPolicy = 'no-referrer';
  } else {
    avatar = document.createElement('div');
    avatar.textContent = t.type === 'Discord' ? '#' : (t.lineName || t.nickname || '?').slice(0, 1);
  }
  avatar.className = 'avatar';

  const main = document.createElement('div');
  main.className = 'friend-main';
  const name = document.createElement('p');
  name.className = 'friend-name' + (t.nickname ? '' : ' unset');
  name.textContent = t.nickname || '尚未設定暱稱';
  const meta = document.createElement('p');
  meta.className = 'friend-meta';
  const parts = [];
  if (t.lineName && t.lineName !== t.nickname) parts.push(t.lineName);
  parts.push(t.type === 'Discord' ? 'Discord 頻道' : t.type.replace('LINE ', ''));
  if (t.cost) parts.push('約 ' + t.cost + ' 人');
  if (currentBot === 'all' && t.bot) parts.push(t.botName);
  if (t.joinedAt) parts.push(joinFmt.format(new Date(t.joinedAt)) + ' 加入');
  meta.textContent = parts.join(' · ');
  if (t.note) {
    const warn = document.createElement('span');
    warn.className = 'warn';
    warn.textContent = ' · ' + t.note;
    meta.append(warn);
  }
  main.append(name, meta);

  const edit = document.createElement('button');
  edit.className = 'edit-btn';
  edit.type = 'button';
  edit.textContent = t.nickname ? '改暱稱' : '設定暱稱';
  edit.addEventListener('click', () => openNicknameEditor(li, t, edit));

  li.append(avatar, main, edit);
  return li;
}

function openNicknameEditor(li, t, editBtn) {
  if (li.querySelector('.nick-form')) return;
  editBtn.hidden = true;
  const form = document.createElement('form');
  form.className = 'nick-form';
  const input = document.createElement('input');
  input.value = t.nickname;
  input.placeholder = '輸入暱稱';
  input.maxLength = 20;
  const save = document.createElement('button');
  save.className = 'save';
  save.type = 'submit';
  save.textContent = '儲存';
  const cancel = document.createElement('button');
  cancel.className = 'cancel';
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => { form.remove(); editBtn.hidden = false; });
  form.append(input, save, cancel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    save.textContent = '儲存中…';
    try {
      const res = await api('setNickname', { bot: t.bot, id: t.id, nickname: input.value });
      if (!res.ok) {
        toast(res.error);
        save.disabled = false;
        save.textContent = '儲存';
        return;
      }
      t.nickname = input.value.trim();
      renderFriends();
      toast('已儲存');
    } catch (err) {
      toast('儲存失敗，請稍後再試');
      save.disabled = false;
      save.textContent = '儲存';
    }
  });
  li.append(form);
  input.focus();
}

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
    // 沒聽到聲音或被我們自己中止屬正常狀況，onend 會重新開始收音
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    const messages = {
      'not-allowed': '沒有麥克風權限。請到瀏覽器或手機設定允許此網站使用麥克風；iPhone 從主畫面開啟若不行，請改用 Safari 開啟。',
      'service-not-allowed': '這個開啟方式不能使用語音辨識。iPhone 請改用 Safari 開啟網址，或用下方打字。',
      'audio-capture': '找不到麥克風，請確認裝置的麥克風可以使用。',
      'network': '語音辨識需要網路，請檢查連線後再試。',
      'language-not-supported': '這個瀏覽器不支援中文語音辨識，請改用 Chrome 或 Safari，或用下方打字。',
    };
    stopConversation(messages[e.error] || '語音辨識發生問題（' + e.error + '），可以先用下方打字。');
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
    stopConversation('無法開始收音（' + e.message + '），可以先用下方打字。');
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
    stopConversation('這個瀏覽器不支援語音辨識。iPhone 請用 Safari，電腦請用 Chrome；也可以用下方打字。');
    $('text-input').focus();
    return;
  }

  setMicState('speaking');
  await speak(greeting);
  if (voice.active) setTimeout(listen, 300);
}

function stopConversation(message) {
  voice.active = false;
  const r = voice.recog;
  voice.recog = null;
  if (r) { try { r.abort(); } catch (e) { /* 已停止 */ } }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!voice.busy) setMicState('idle');
  // 錯誤說明要留在畫面上，使用者才知道為什麼停下來
  if (message) $('mic-status').textContent = message;
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
  loadBots();
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
