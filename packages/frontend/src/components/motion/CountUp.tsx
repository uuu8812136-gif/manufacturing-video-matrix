import { useEffect, useState } from 'react';
import { useSpring } from 'framer-motion';

export function CountUp({ value, duration = 1.2 }: { value: number; duration?: number }) {
  const spring = useSpring(0, { duration: duration * 1000, bounce: 0 });
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    spring.set(value);
    const unsub = spring.on('change', (v: number) => setDisplay(v));
    return () => unsub();
  }, [value, spring]);
  return <span className="tnum">{Math.round(display).toLocaleString()}</span>;
}
