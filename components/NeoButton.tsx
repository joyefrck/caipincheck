
import React from 'react';

interface NeoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'orange';
  size?: 'sm' | 'md' | 'lg';
}

const NeoButton: React.FC<NeoButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md',
  className = '',
  ...props 
}) => {
  const variants = {
    primary: 'bg-[#FFEB3B]',
    secondary: 'bg-[#9C27B0] text-white',
    danger: 'bg-[#FF1744] text-white',
    success: 'bg-[#00E676]',
    warning: 'bg-[#FF9100]',
    orange: 'bg-[#FF5722] text-white',
  };

  const sizes = {
    sm: 'px-4 py-1 text-sm font-black',
    md: 'px-6 py-3 font-black text-lg',
    lg: 'px-6 py-4 text-xl md:text-2xl font-black uppercase tracking-tight',
  };

  return (
    <button
      className={`
        ${variants[variant]} 
        ${sizes[size]} 
        border-[6px] border-black 
        neo-shadow 
        neo-shadow-hover 
        active:translate-x-1 active:translate-y-1 active:shadow-none
        transition-all duration-100
        hover:rotate-1
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
};

export default NeoButton;
