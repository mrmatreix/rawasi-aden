const config=require('../config/environment');
function securityHeaders(req,res,next){
 res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'geolocation=(), microphone=()','Cross-Origin-Resource-Policy':'same-origin'});
 if(config.isProd)res.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 if(req.path.startsWith('/api/')||req.path.startsWith('/uploads/'))res.set('Cache-Control','no-store');
 if(!config.isDev){const send=res.json.bind(res);res.json=body=>{if(body&&typeof body==='object'&&!Array.isArray(body)){body={...body};delete body.error;delete body.stack;if(res.statusCode>=500)body.message='تعذر إتمام الطلب، يرجى المحاولة لاحقاً';}return send(body);};}
 next();
}
function corsOptions(){return {credentials:false,origin(origin,cb){if(!origin)return cb(null,true);if(config.allowedOrigins.includes(origin)||(!config.isProd&& !config.isStaging && /^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/.test(origin)))return cb(null,true);return cb(null,false);},methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Authorization','Content-Type','X-CSRF-Token','X-Requested-With','X-Client-Token','X-Passphrase']};}
function originGuard(req,res,next){
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 const origin=req.headers.origin;if(!origin)return next();
 let same=false;try{const parsed=new URL(origin);same=parsed.host===req.get('host')&&['http:','https:'].includes(parsed.protocol);}catch{}
 if(same||config.allowedOrigins.includes(origin)||(!config.isProd&&!config.isStaging&&/^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/.test(origin)))return next();
 return res.status(403).json({success:false,message:'مصدر الطلب غير مسموح'});
}
function createRateLimiter({windowMs=60000,max=120}={}){const entries=new Map();const timer=setInterval(()=>{const now=Date.now();for(const [k,v]of entries)if(now>=v.until)entries.delete(k);},windowMs);timer.unref();return(req,res,next)=>{const key=req.ip||req.socket.remoteAddress;const now=Date.now();let entry=entries.get(key);if(!entry||now>=entry.until){entry={count:0,until:now+windowMs};entries.set(key,entry);}if(++entry.count>max){res.set('Retry-After',String(Math.ceil((entry.until-now)/1000)));return res.status(429).json({success:false,message:'طلبات كثيرة، يرجى المحاولة لاحقاً'});}next();};}
module.exports={securityHeaders,corsOptions,originGuard,createRateLimiter};
