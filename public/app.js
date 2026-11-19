const loadFeedback=document.createElement('p');loadFeedback.className='load-feedback';loadFeedback.setAttribute('role','status');loadFeedback.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;background:#fff8dd;color:#222;padding:12px 20px;margin:0;font:14px/1.5 system-ui;border-radius:8px';document.querySelector('main').prepend(loadFeedback);let lastLoadArgs=[];
async function load(...args){lastLoadArgs=args;loadFeedback.hidden=false;loadFeedback.textContent='Загрузка данных…';try{await loadData(...args);loadFeedback.textContent='';loadFeedback.hidden=true;}catch(error){loadFeedback.textContent='Не удалось загрузить данные. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Повторить загрузку';retry.onclick=()=>load(...lastLoadArgs);loadFeedback.append(retry);}}
const escapeText=v=>String(v).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "\'":"&#39;"}[c]));
let capsules=[];const now=()=>new Date();const date=v=>new Date(v).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});const days=v=>Math.max(0,Math.ceil((new Date(v)-now())/86400000));
const more = document.createElement('button');
more.type = 'button';
more.textContent = 'Показать ещё капсулы';
more.hidden = true;
document.querySelector('#capsule-grid').after(more);
more.onclick = async () => {
  more.disabled = true;
  try { await load(true); } finally { more.disabled = false; }
};
async function loadData(append = false) {
 const offset = append ? capsules.length : 0;
 const page = await fetch('/api/capsules?offset=' + offset).then(r => {
   if (!r.ok) throw new Error('HTTP ' + r.status);
   return r.json();
 });
 capsules = append ? [...capsules, ...page] : page;
 more.hidden = page.length < 100;
document.querySelector('#capsule-count').textContent=String(capsules.length).padStart(2,'0');document.querySelector('#capsule-grid').innerHTML=capsules.map((c,i)=>`<article class="capsule-card ${c.locked?'locked':''}" style="--color:${c.color}" data-id="${c.id}"><div class="capsule-top"><span>${String(i+1).padStart(2,'0')} / ${c.theme.toUpperCase()}</span><span>${c.locked?'SEALED':'READY'}</span></div><div class="capsule-glyph">${c.locked?'◌':'✦'}</div><h3>${escapeText(c.title)}</h3><p>${escapeText(c.sender)} → ${escapeText(c.recipient)}</p><div class="capsule-foot"><span>${c.locked?`Ещё ${days(c.unlock_at)} дн.`:date(c.unlock_at)}</span><button ${c.locked?'disabled':''}>${c.locked?'Запечатано':'Открыть →'}</button></div></article>`).join('');document.querySelectorAll('.capsule-card').forEach(card=>card.onclick=()=>openCapsule(Number(card.dataset.id)))}
function openCapsule(id){const c=capsules.find(x=>x.id===id);if(c.locked)return;const dialog=document.querySelector('.open-dialog');document.querySelector('[name=id]').value=id;document.querySelector('#open-title').textContent=c.title;document.querySelector('#open-hint').textContent=c.hint;document.querySelector('.revealed').classList.remove('show');document.querySelector('.revealed').textContent='';document.querySelector('.error').textContent='';dialog.showModal()}
document.querySelectorAll('.close').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelector('.create').onclick=()=>document.querySelector('.create-dialog').showModal();
const capsuleCrypto = () => import('./vendor/capsule-crypto.js');
document.querySelector('#open-form').onsubmit = async event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const id = Number(data.get('id'));
  const passphrase = data.get('passphrase');
  const capsule = capsules.find(item => item.id === id);
  const error = document.querySelector('.error');
  const revealed = document.querySelector('.revealed');
  error.textContent = '';
  let message;
  if (!globalThis.PORTFOLIO_DEMO || capsule?.encryption === 'drand-quicknet-v1') {
    const response = await fetch(`/api/capsules/${id}/envelope`);
    if (!response.ok) throw new Error('Envelope unavailable');
    const { decryptCapsule, decryptLegacyCapsule } = await capsuleCrypto();
    try {
      const envelope = await response.json();
      message = capsule?.encryption === 'drand-quicknet-v1'
        ? await decryptCapsule(envelope, passphrase)
        : await decryptLegacyCapsule(envelope, passphrase);
    } catch (failure) {
      if (failure.name !== 'OperationError') throw failure;
      error.textContent = 'Пароль не подходит';
      return;
    }
  } else {
    const response = await fetch(`/api/capsules/${id}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    const out = await response.json();
    if (!response.ok) {
      error.textContent = out.message;
      return;
    }
    message = out.message;
  }
  revealed.textContent = message;
  revealed.classList.add('show');
};

document.querySelector('#create-form').onsubmit = async event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const payload = {
    sender: data.get('sender'),
    recipient: data.get('recipient'),
    title: data.get('title'),
    unlockAt: new Date(data.get('unlockAt')).toISOString(),
    hint: data.get('hint'),
    theme: 'orbit',
  };
  const { encryptCapsule } = await capsuleCrypto();
  const message = data.get('message').trim();
  if (message.length < 10) {
    document.querySelector('.create-status').textContent = 'Напишите сообщение длиной от 10 символов.';
    return;
  }
  payload.sealed = await encryptCapsule(message, data.get('passphrase'), payload.unlockAt);
  const response = await fetch('/api/capsules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.afterglow.sealed+json' },
    body: JSON.stringify(payload),
  });
  const out = await response.json();
  document.querySelector('.create-status').textContent = response.ok
    ? 'Капсула зашифрована в браузере и сохранена.'
    : out.message;
  if (response.ok) {
    event.target.reset();
    await load();
  }
};
load();

const unlockInput=document.querySelector('[name=unlockAt]');if(unlockInput){const tomorrow=new Date(Date.now()+86400000);const local=new Date(tomorrow.getTime()-tomorrow.getTimezoneOffset()*60000).toISOString().slice(0,16);unlockInput.min=local;unlockInput.value=local;}

for(const form of document.querySelectorAll('form')){const submit=form.onsubmit;if(!submit)continue;form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type=submit],button.send,button:not([type])');if(button)button.disabled=true;try{await submit(event);}catch{let message=form.querySelector('[role=alert]');if(!message){message=document.createElement('p');message.setAttribute('role','alert');form.append(message);}message.textContent='Не удалось выполнить запрос. Повторите действие; введённые данные остаются в форме.';}finally{if(button)button.disabled=false;}};}
