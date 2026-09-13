import { useEffect, useState } from 'react';

/** Poll only while visible; one request at a time, bounded timeout, clean cancellation. */
export function useLiveData<T>(url: string | null) {
  const [state,setState] = useState<{data?:T;error:string;loading:boolean;checkedAt:number|null;denied:boolean}>({error:'',loading:true,checkedAt:null,denied:false});
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    setState({error:'',loading:!!url,checkedAt:null,denied:false});
    if (!url) return;
    let disposed=false, busy=false, timer:ReturnType<typeof setTimeout>, active:AbortController|undefined;
    let failures=0;
    const refresh = async () => {
      if(disposed || busy || document.hidden) return;
      clearTimeout(timer); busy=true; active=new AbortController();
      const timeout=setTimeout(()=>active?.abort(),15000);
      try {
        const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:active.signal});
        if(disposed) return;
        if([401,403].includes(response.status)) {
          setState({error:'Sign in with an authorized staff account.',loading:false,checkedAt:null,denied:true});
          return;
        }
        if(!response.ok)throw Error('Refresh unavailable. Showing the last received data.');
        const data=await response.json() as T;
        if(!disposed){setState({data,error:'',loading:false,checkedAt:Date.now(),denied:false});failures=0;}
      } catch { if(!disposed){failures++;setState(old=>({...old,error:'Refresh unavailable. Data may be out of date.',loading:false}));} }
      finally {clearTimeout(timeout);busy=false;if(!disposed)timer=setTimeout(refresh,Math.min(120000,30000*2**failures));}
    };
    const visible=()=>{if(!document.hidden)void refresh();};
    void refresh(); document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;clearTimeout(timer);active?.abort();document.removeEventListener('visibilitychange',visible);};
  },[url,revision]);
  return {...state,refresh:()=>setRevision(n=>n+1)};
}
