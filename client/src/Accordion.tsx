import {createContext, useContext, useId, useRef, useState, useEffect, type ReactNode} from 'react';

const AccordionContext = createContext<{active:string|null;setActive:(value:string|null)=>void}|null>(null);
export function AccordionGroup({children}:{children:ReactNode}) {
  const [active,setActive] = useState<string|null>(null);
  return <AccordionContext.Provider value={{active,setActive}}><div className="v7-accordion-group">{children}</div></AccordionContext.Provider>;
}
export function Accordion({title,description,children}:{title:string;description?:string;children:ReactNode}) {
  const group = useContext(AccordionContext)!;
  const id = useId();
  const open = group.active === id;
  const [mounted,setMounted] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open)setMounted(true);},[open]);
  useEffect(()=>{if(open)body.current?.removeAttribute('inert');else body.current?.setAttribute('inert','');},[open]);
  return <section className="v7-accordion">
    <h2><button type="button" className="v7-accordion-trigger" aria-expanded={open} aria-controls={`${id}-body`} onClick={()=>group.setActive(open?null:id)}>
      <span><strong>{title}</strong>{description&&<small>{description}</small>}</span>
      <svg className={open?'is-open':''} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button></h2>
    <div ref={body} id={`${id}-body`} className={`v7-accordion-body${open?' is-open':''}`} aria-hidden={!open}>
      <div className="v7-accordion-clip"><div className="v7-accordion-content">{mounted&&children}</div></div>
    </div>
  </section>;
}
