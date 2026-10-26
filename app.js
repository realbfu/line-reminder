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

// TODO(2026-10-26): 第三階段改成真正的語音對話
$('mic-btn').addEventListener('click', () => {
  const wrap = document.querySelector('.mic-wrap');
  const active = !wrap.classList.contains('active');
  wrap.classList.toggle('active', active);
  $('mic-btn').setAttribute('aria-pressed', String(active));
  $('mic-btn').setAttribute('aria-label', active ? '結束對話' : '開始對話');
  $('mic-status').textContent = active ? '語音對話會在下一階段加入，再點一下結束' : '';
});

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
