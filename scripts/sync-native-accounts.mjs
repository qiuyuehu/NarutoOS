// Explicit local import; source files/keychain stay unchanged. Secrets only cross
// the private socket in memory and never enter arguments, logs or artifact files.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const project=path.resolve(import.meta.dirname,'..');
const root=path.join(project,'.test-artifacts/native-core-live');
const source=path.join(os.homedir(),'Library/Application Support/Naruto OS');
const catalog=JSON.parse(fs.readFileSync(path.join(source,'account-profiles.json'),'utf8'));
if(catalog.version!==1||!Array.isArray(catalog.profiles)||catalog.pendingDeletes?.length)throw Error('旧档案格式异常或仍在清理，未同步');
const token=JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'),'utf8')).center;
const socket='/tmp/naruto-c-'+process.getuid()+'-'+crypto.createHash('sha256').update(root).digest('hex').slice(0,16)+'.sock';
function request(command,payload={}){return new Promise((resolve,reject)=>{const client=net.createConnection(socket);let data='';const timer=setTimeout(()=>{client.destroy();reject(Error('核心同步超时'))},10000);client.on('error',()=>{clearTimeout(timer);reject(Error('请先打开新版启动中心'))});client.on('connect',()=>client.write(JSON.stringify({v:1,role:'center',token,command,payload})+'\n'));client.on('data',bytes=>{data+=bytes;if(!data.includes('\n'))return;clearTimeout(timer);client.end();try{const r=JSON.parse(data.split('\n')[0]);if(!r.ok)throw Error(r.message||'核心未接受同步');resolve(r.value)}catch(e){reject(e)}})})}
function readPasswords(){return new Promise((resolve,reject)=>{const child=spawn(path.join(project,'dist/native/keychain'),[],{stdio:['pipe','pipe','ignore']});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('钥匙串读取超时'))},60000);child.on('error',()=>{clearTimeout(timer);reject(Error('钥匙串组件不可用'))});child.stdout.on('data',b=>output+=b);child.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(output);if(!r.ok)throw Error();const records=JSON.parse(r.value);if(!Array.isArray(records))throw Error();resolve(records)}catch{reject(Error('旧密码库读取失败，原资料保留'))}});child.stdin.end(JSON.stringify({action:'read',service:'cn.youye.naruto-os.credentials'}))})}
const credentials=await readPasswords();
const snapshot=await request('snapshot');
const result=await request('catalog.importLocal',{requestId:crypto.randomUUID(),revision:snapshot.revision,profiles:catalog.profiles,selectedByRegion:catalog.selectedByRegion,deletedIds:catalog.deletedIds,credentials});
console.log(JSON.stringify({profiles:result.profiles,credentialsChanged:result.credentialsChanged,credentialsTotal:result.credentialsTotal}));
