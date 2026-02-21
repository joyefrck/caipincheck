import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Recipe } from '../types';
import NeoButton from './NeoButton';

interface FocusCookingModeProps {
  recipe: Recipe;
  onClose: () => void;
}

interface FlatStep {
  dishIndex: number;
  dishName: string;
  stepNum: number;
  totalSteps: number;
  description: string;
}

const FocusCookingMode: React.FC<FocusCookingModeProps> = ({ recipe, onClose }) => {
  const [flatIndex, setFlatIndex] = useState(0);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  const steps = useMemo(() => {
    const arr: FlatStep[] = [];
    recipe.dishes.forEach((dish, dIdx) => {
      dish.instructions.forEach((ins, iIdx) => {
        arr.push({
          dishIndex: dIdx,
          dishName: dish.name,
          stepNum: ins.step,
          totalSteps: dish.instructions.length,
          description: ins.description,
        });
      });
    });
    return arr;
  }, [recipe]);

  // Wake Lock Setup
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          const lock = await navigator.wakeLock.request('screen');
          setWakeLock(lock);
        }
      } catch (err: any) {
        console.warn('Wake Lock error:', err.name, err.message);
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(console.error);
      }
    };
  }, []);

  const currentStep = steps[flatIndex];

  // 从文本中提取分钟数
  const extractMinutes = (text: string): number | null => {
    const match = text.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十|半|个)[\s]*个?(分钟|小时)/);
    if (match) {
      if (match[2] === '小时') {
        const h = parseInt(match[1]);
        if (!isNaN(h)) return h * 60;
        if (match[1] === '半') return 30;
        if (match[1] === '一' || match[1] === '个') return 60;
      }
      const m = parseInt(match[1]);
      if (!isNaN(m)) return m;
      const numMap: Record<string, number> = {
        '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, 
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '半': 0.5
      };
      return numMap[match[1]] || null;
    }
    return null;
  };

  const detectedMinutes = useMemo(() => {
    if (!currentStep) return null;
    return extractMinutes(currentStep.description);
  }, [currentStep]);

  // 定时器逻辑
  useEffect(() => {
    if (timerSeconds !== null && timerSeconds > 0) {
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else if (timerSeconds === 0) {
      // 播放提示音 (可选，浏览器策略可能阻止，尽量简单)
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        oscillator.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
      } catch(e) {}
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerSeconds]);

  // 切换步骤时重置定时器
  useEffect(() => {
    setTimerSeconds(null);
  }, [flatIndex]);

  const handleNext = () => {
    if (flatIndex < steps.length - 1) setFlatIndex(prev => prev + 1);
  };

  const handlePrev = () => {
    if (flatIndex > 0) setFlatIndex(prev => prev - 1);
  };

  if (!currentStep) return null;

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#FFFBF0] flex flex-col justify-between animate-in fade-in zoom-in-95 duration-300">
      {/* 顶部状态栏 */}
      <div className="flex justify-between items-center p-6 md:p-10 border-b border-orange-100 bg-white shadow-sm">
        <div className="flex flex-col">
          <span className="text-xl md:text-2xl font-bold text-[#8D6E63] flex items-center gap-2">
            🍳 {currentStep.dishName}
          </span>
          <span className="text-sm md:text-lg font-semibold text-[#FF8A65] mt-1">
            第 {currentStep.stepNum} 步 / 共 {currentStep.totalSteps} 步
            <span className="text-gray-400 ml-4 font-normal text-sm md:text-base">
              (总进度 {flatIndex + 1}/{steps.length})
            </span>
          </span>
        </div>
        <button 
          onClick={onClose}
          className="text-[#6D4C41] hover:text-[#D84315] font-bold text-lg md:text-xl px-6 py-2 rounded-full border border-orange-200 bg-orange-50 transition-colors"
        >
          推出烹饪退出 ✕
        </button>
      </div>

      {/* 核心内容区 */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 md:p-16 overflow-y-auto">
        <p className="text-3xl md:text-5xl lg:text-7xl font-black text-[#4E342E] leading-relaxed text-center max-w-5xl self-center">
          {currentStep.description}
        </p>

        {/* 倒计时检测与展示 */}
        {detectedMinutes && (
          <div className="mt-12 md:mt-20 flex flex-col items-center animate-in slide-in-from-bottom-8">
            {timerSeconds === null ? (
              <button 
                onClick={() => setTimerSeconds(Math.floor(detectedMinutes * 60))}
                className="bg-[#2E7D32] text-white px-10 py-5 rounded-full text-2xl md:text-4xl font-bold shadow-lg hover:bg-[#1B5E20] hover:scale-105 transition-all flex items-center gap-4"
              >
                🕗 开启 {detectedMinutes} 分钟倒计时
              </button>
            ) : (
              <div className="flex flex-col items-center">
                <div className={`text-6xl md:text-8xl font-black ${timerSeconds === 0 ? 'text-[#D84315] animate-pulse' : 'text-[#2E7D32]'} font-mono mb-4`}>
                  {formatTimer(timerSeconds)}
                </div>
                {timerSeconds === 0 ? (
                  <button onClick={() => setTimerSeconds(null)} className="text-xl font-bold text-[#D84315] border-2 border-[#D84315] px-6 py-2 rounded-full hover:bg-orange-50">
                    停止闹钟
                  </button>
                ) : (
                  <button onClick={() => setTimerSeconds(null)} className="text-lg font-bold text-gray-400 hover:text-gray-600 underline">
                    取消倒计时
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部控制器 */}
      <div className="p-6 md:p-10 bg-white border-t border-orange-100 flex justify-between gap-4">
        <NeoButton 
          onClick={handlePrev} 
          disabled={flatIndex === 0} 
          variant="secondary"
          className="flex-1 text-2xl md:text-4xl py-6 md:py-8 disabled:opacity-30 border-orange-200 text-[#8D6E63] hover:bg-orange-50 bg-white"
        >
          👈 上一步
        </NeoButton>
        <NeoButton 
          onClick={handleNext} 
          disabled={flatIndex === steps.length - 1} 
          variant="primary"
          className="flex-1 text-2xl md:text-4xl py-6 md:py-8 disabled:opacity-30"
        >
          下一步 👉
        </NeoButton>
      </div>
    </div>
  );
};

export default FocusCookingMode;
