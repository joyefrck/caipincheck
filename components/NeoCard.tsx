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
    <div className={`rounded-3xl border-2 border-orange-100/50 ${color} neo-shadow-lg p-6 relative overflow-hidden transition-all duration-300 ${className}`}>
      {hasMarquee && (
        <div className="absolute top-0 left-0 w-full bg-[#FF8A65] text-white py-1 overflow-hidden z-10 opacity-90">
          <div className="animate-marquee font-bold text-xs tracking-wider">
            ★ 温馨推荐 ★ 今日主厨精选 ★ 美味预警 ★ 为家人准备的惊喜 ★ 
          </div>
        </div>
      )}
      {title && (
        <h2 className={`text-2xl font-bold mb-6 text-[#4E342E] tracking-tight border-b-2 border-orange-100 pb-3 flex items-center gap-2 ${hasMarquee ? 'mt-6' : ''}`}>
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
