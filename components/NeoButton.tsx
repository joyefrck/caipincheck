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
    primary: 'bg-[#FFB74D] text-[#4E342E] hover:bg-[#FFA726]', // 温暖金橘
    secondary: 'bg-[#CE93D8] text-white hover:bg-[#BA68C8]',   // 柔和浅紫
    danger: 'bg-[#EF5350] text-white hover:bg-[#E53935]',     // 柔和珊瑚红
    success: 'bg-[#81C784] text-white hover:bg-[#66BB6A]',    // 清新草绿
    warning: 'bg-[#FFCA28] text-[#4E342E] hover:bg-[#FFB300]', // 鹅黄
    orange: 'bg-[#FF8A65] text-white hover:bg-[#FF7043]',      // 暖橙
  };

  const sizes = {
    sm: 'px-4 py-1.5 text-sm font-bold',
    md: 'px-6 py-2.5 font-bold text-lg',
    lg: 'px-8 py-3.5 text-xl md:text-2xl font-bold tracking-wide',
  };

  return (
    <button
      className={`
        ${variants[variant]} 
        ${sizes[size]} 
        rounded-2xl
        shadow-sm hover:shadow-md
        active:scale-95 active:shadow-inner
        transition-all duration-200 ease-out
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
};

export default NeoButton;
