import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = dirname(fileURLToPath(import.meta.url));
const hex = value => Buffer.from(value).toString('hex');

export function seal(message, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
  return { ciphertext: hex(ciphertext), salt: hex(salt), iv: hex(iv), tag: hex(cipher.getAuthTag()) };
}

export function unseal(row, passphrase) {
  const key = scryptSync(passphrase, Buffer.from(row.salt, 'hex'), 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

export function createDb(file = resolve(root, 'data', 'afterglow.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS capsules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,sender TEXT NOT NULL,
    recipient TEXT NOT NULL,unlock_at TEXT NOT NULL,theme TEXT NOT NULL,color TEXT NOT NULL,
    hint TEXT NOT NULL,ciphertext TEXT NOT NULL,salt TEXT NOT NULL,iv TEXT NOT NULL,tag TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
  const { count } = db.prepare('SELECT COUNT(*) count FROM capsules').get();
  if (!count) {
    const add = db.prepare('INSERT INTO capsules(title,sender,recipient,unlock_at,theme,color,hint,ciphertext,salt,iv,tag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    const seeds = [
      ['Свет самого длинного дня','Роман','Будущему себе','2026-06-21T09:00:00','solstice','#f0c96b','Пароль для демо: light','Ты хотел помнить не планы, а ощущение: тёплый воздух, открытое окно и редкий день без спешки.','light','2026-05-11T18:20:00'],
      ['До следующего июля','Команда','Всем нам','2026-07-01T12:00:00','orbit','#8e7bc7','Пароль для демо: orbit','За этот год мы научились не бояться сложных задач и чаще показывать работу до того, как она стала идеальной.','orbit','2025-07-01T12:00:00'],
      ['Первый снег будущего года','Аня','Мише','2026-12-01T08:00:00','winter','#8eb5c9','Откроется зимой','Секретная зимняя капсула.','snow','2026-03-02T09:14:00'],
      ['Когда город станет тише','Неизвестный автор','Москва','2027-01-01T00:00:00','city','#df8067','Откроется в новом году','Сообщение городу будущего.','city','2026-01-01T00:01:00']
    ];
    for (const [title,sender,recipient,unlockAt,theme,color,hint,message,password,createdAt] of seeds) {
      const encrypted = seal(message,password);
      add.run(title,sender,recipient,unlockAt,theme,color,hint,encrypted.ciphertext,encrypted.salt,encrypted.iv,encrypted.tag,createdAt);
    }
  }
  return db;
}

const createSchema = z.object({
  title:z.string().trim().min(3).max(80), sender:z.string().trim().min(2).max(50),
  recipient:z.string().trim().min(2).max(50), unlockAt:z.string().datetime(),
  message:z.string().trim().min(10).max(3000), passphrase:z.string().min(4).max(100),
  hint:z.string().trim().max(100).default(''), theme:z.enum(['solstice','orbit','winter','city']).default('orbit'),
});
const colors={solstice:'#f0c96b',orbit:'#8e7bc7',winter:'#8eb5c9',city:'#df8067'};
const publicCapsule = row => ({ id:row.id,title:row.title,sender:row.sender,recipient:row.recipient,unlock_at:row.unlock_at,theme:row.theme,color:row.color,hint:row.hint,created_at:row.created_at,locked:new Date(row.unlock_at)>new Date() });

export function createApp(db = createDb()) {
  const app=express(); app.use(express.json());
  app.get('/api/capsules',(_req,res)=>res.json(db.prepare('SELECT * FROM capsules ORDER BY unlock_at').all().map(publicCapsule)));
  app.get('/api/capsules/:id',(req,res)=>{const row=db.prepare('SELECT * FROM capsules WHERE id=?').get(Number(req.params.id));return row?res.json(publicCapsule(row)):res.status(404).json({message:'Капсула не найдена'})});
  app.post('/api/capsules',(req,res)=>{const parsed=createSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Проверьте данные капсулы'});const c=parsed.data;if(new Date(c.unlockAt)<=new Date())return res.status(400).json({message:'Дата открытия должна быть в будущем'});const encrypted=seal(c.message,c.passphrase);const out=db.prepare('INSERT INTO capsules(title,sender,recipient,unlock_at,theme,color,hint,ciphertext,salt,iv,tag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(c.title,c.sender,c.recipient,c.unlockAt,c.theme,colors[c.theme],c.hint,encrypted.ciphertext,encrypted.salt,encrypted.iv,encrypted.tag,new Date().toISOString());res.status(201).json({id:Number(out.lastInsertRowid),unlockAt:c.unlockAt})});
  app.post('/api/capsules/:id/open',(req,res)=>{const parsed=z.object({passphrase:z.string().min(1)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Введите пароль'});const row=db.prepare('SELECT * FROM capsules WHERE id=?').get(Number(req.params.id));if(!row)return res.status(404).json({message:'Капсула не найдена'});if(new Date(row.unlock_at)>new Date())return res.status(423).json({message:'Капсула ещё запечатана',unlockAt:row.unlock_at});try{return res.json({message:unseal(row,parsed.data.passphrase),openedAt:new Date().toISOString()})}catch{return res.status(401).json({message:'Пароль не подходит'})}});
  app.use(express.static(resolve(root,'public')));app.get(/^(?!\/api).*/,(_q,res)=>res.sendFile(resolve(root,'public','index.html')));return app;
}
if(process.env.NODE_ENV!=='test')createApp().listen(process.env.PORT||4800,()=>console.log('Afterglow: http://localhost:4800'));
