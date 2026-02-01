
import React from 'react';

interface NeoCardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  color?: string;
  hasMarquee?: boolean;
}

const NeoCard: React.FC<NeoCardProps> = ({ 
  children, 
  className = '', 
  title,
  color = 'bg-white',
  hasMarquee = false
}) => {
  return (
    <div className={`border-[6px] border-black ${color} neo-shadow-lg p-6 relative overflow-hidden ${className}`}>
      {hasMarquee && (
        <div className="absolute top-0 left-0 w-full bg-black text-white py-1 overflow-hidden z-10 border-b-[4px] border-black">
          <div className="animate-marquee font-black uppercase text-xs tracking-widest">
            ★ HOT RECOMMENDATION ★ SPECIAL OF THE DAY ★ CHEF CAI'S CHOICE ★ YUMMY ALERT ★ 
          </div>
        </div>
      )}
      {title && (
        <h2 className={`text-3xl font-black mb-6 uppercase tracking-tighter border-b-[6px] border-black pb-2 flex items-center gap-2 ${hasMarquee ? 'mt-6' : ''}`}>
          {title}
        </h2>
      )}
      <div className="relative z-0">
        {children}
      </div>
    </div>
  );
};

export default NeoCard;
