const https = require('https');
const CHANNELS = new Set(['bob-wacken','powermetal','progrock','bob-ironmaiden','bob-metal']);
const respond=(status,body)=>({statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
function fetchIcy(channel){return new Promise((resolve,reject)=>{
 const url=`https://streams.radiobob.de/${channel}/mp3-192/streams.radiobob.de/`;
 let done=false;const finish=(err,value)=>{if(done)return;done=true;err?reject(err):resolve(value)};
 const req=https.get(url,{headers:{'Icy-MetaData':'1','User-Agent':'WackenRadioMetadata/1.0','Accept':'*/*'}},res=>{
  if([301,302,307,308].includes(res.statusCode)){res.destroy();return finish(Error('redirect'))}
  if(res.statusCode!==200){res.destroy();return finish(Error('upstream status '+res.statusCode))}
  const interval=Number(res.headers['icy-metaint']);
  if(!Number.isInteger(interval)||interval<=0||interval>1000000){res.destroy();return finish(null,null)}
  let remaining=interval, metadataBytes=-1, metadata=[], size=0;
  res.on('data',chunk=>{
   let i=0;
   while(i<chunk.length && !done){
    if(remaining>0){const n=Math.min(remaining,chunk.length-i);remaining-=n;i+=n;continue}
    if(metadataBytes===-1){metadataBytes=chunk[i++]*16;if(metadataBytes===0){res.destroy();return finish(null,null)}}
    if(metadataBytes>0){const n=Math.min(metadataBytes,chunk.length-i);metadata.push(chunk.subarray(i,i+n));size+=n;metadataBytes-=n;i+=n;
     if(metadataBytes===0){const value=Buffer.concat(metadata,size).toString('utf8');res.destroy();return finish(null,value)}
    }
   }
  });
  res.on('error',e=>finish(e));res.on('end',()=>finish(null,null));
 });
 req.setTimeout(7000,()=>req.destroy(Error('timeout')));req.on('error',e=>finish(e));
})}
exports.handler=async(event)=>{
 const channel=event.queryStringParameters?.channel;
 if(!CHANNELS.has(channel))return respond(400,{error:'invalid channel'});
 try{
  const metadata=await fetchIcy(channel);
  if(!metadata)return respond(200,{artist:null,title:null,raw:null,source:'icy'});
  const match=/StreamTitle='([^']*)'/i.exec(metadata);
  const raw=(match?.[1]||'').trim().slice(0,350);
  if(!raw)return respond(200,{artist:null,title:null,raw:null,source:'icy'});
  const split=raw.indexOf(' - ');
  return respond(200,{artist:split>0?raw.slice(0,split):null,title:split>0?raw.slice(split+3):null,raw,source:'icy'});
 }catch(e){return respond(502,{error:'metadata_unavailable'})}
};
