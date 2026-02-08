import React, { useState, useEffect, useMemo } from "react";
import NeoButton from "./components/NeoButton";
import NeoCard from "./components/NeoCard";
import { generateRecipe, analyzeUserTaste } from "./services/geminiService";
import { apiService } from "./services/apiService";
import {
  Recipe,
  UserPreferences,
  CuisineType,
  ChineseSubCuisine,
} from "./types";
import {
  CUISINE_OPTIONS,
  CHINESE_SUB_CUISINES,
  TASTE_OPTIONS,
  STORAGE_KEYS,
} from "./constants";

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => sessionStorage.getItem('isLoggedIn') === 'true');
  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState(false);

  const [activeTab, setActiveTab] = useState<"generate" | "cookbook">("generate");
  const [input, setInput] = useState("");
  const [prefs, setPrefs] = useState<UserPreferences>({ diners: 2 });
  const [currentRecipe, setCurrentRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([]);
  const [history, setHistory] = useState<Recipe[]>([]);
  const [sessionDisliked, setSessionDisliked] = useState<string[]>([]);
  const [excludedDishNames, setExcludedDishNames] = useState<string[]>([]);  // 新增：排除的菜名列表
  const [soulIngredient, setSoulIngredient] = useState<string>('');  // 灵魂料理关键词（用于上下文感知排除）
  const [error, setError] = useState<string | null>(null);
  const [tasteProfile, setTasteProfile] = useState<string>("正在火速收集你的美食基因...");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [viewingSavedRecipe, setViewingSavedRecipe] = useState<Recipe | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isRecommendationMode, setIsRecommendationMode] = useState(false);
  const [recommendationSeed, setRecommendationSeed] = useState(0);
  const [isNewRecipe, setIsNewRecipe] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const PAGE_LIMIT = 20;

  useEffect(() => {
    if (!isLoggedIn) return;

    const initData = async () => {
      try {
        const [savedFromApi, historyFromApi] = await Promise.all([
          apiService.getSavedRecipes(1, PAGE_LIMIT),
          apiService.getHistory()
        ]);

        const localSaved = localStorage.getItem(STORAGE_KEYS.SAVED_RECIPES);
        const localHist = localStorage.getItem(STORAGE_KEYS.HISTORY);
        
        let finalSaved = savedFromApi;
        let finalHist = historyFromApi;

        if (savedFromApi.length === 0 && localSaved) {
          const parsedLocalSaved: Recipe[] = JSON.parse(localSaved);
          await Promise.all(parsedLocalSaved.map(r => apiService.saveRecipe(r)));
          finalSaved = parsedLocalSaved.slice(0, PAGE_LIMIT);
          setHasMore(parsedLocalSaved.length > PAGE_LIMIT);
          localStorage.removeItem(STORAGE_KEYS.SAVED_RECIPES);
        }

        if (historyFromApi.length === 0 && localHist) {
          const parsedLocalHist: Recipe[] = JSON.parse(localHist);
          await Promise.all(parsedLocalHist.map(r => apiService.saveHistory(r)));
          finalHist = parsedLocalHist;
          localStorage.removeItem(STORAGE_KEYS.HISTORY);
        }

        setSavedRecipes(finalSaved);
        setHistory(finalHist);
        setHasMore(finalSaved.length === PAGE_LIMIT);
        setPage(1);

        if (finalSaved.length > 0) {
          const today = new Date().setHours(0, 0, 0, 0);
          const todayLatest = finalSaved
            .filter(r => new Date(r.createdAt).setHours(0, 0, 0, 0) === today)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          
          if (todayLatest) {
            setCurrentRecipe(todayLatest);
            setIsNewRecipe(false);
          }
        }
      } catch (err) {
        console.error("初始化数据失败:", err);
        setError("无法连接到后端数据库，请确保后端服务已启动。");
      }
    };

    initData();
  }, [isLoggedIn]);

  // 口令校验处理
  const handleLogin = () => {
    if (loginInput.trim() === '彼得勇') {
      setIsLoggedIn(true);
      sessionStorage.setItem('isLoggedIn', 'true');
      setLoginError(false);
    } else {
      setLoginError(true);
      setTimeout(() => setLoginError(false), 1000);
    }
  };


  useEffect(() => {
    if (savedRecipes.length > 0) {
      const timer = setTimeout(async () => {
        setIsAnalyzing(true);
        const profile = await analyzeUserTaste(savedRecipes);
        setTasteProfile(profile);
        setIsAnalyzing(false);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setTasteProfile("还没开饭？快去收藏第一道灵魂料理！");
    }
  }, [savedRecipes]);

  const recommendationBase = useMemo(() => {
    // Randomly pick a cuisine for the "lucky draw" feel
    const randomCuisine = CUISINE_OPTIONS[Math.floor(Math.random() * CUISINE_OPTIONS.length)];
    let randomSub: ChineseSubCuisine = '不限';
    
    if (randomCuisine === '中餐') {
      randomSub = CHINESE_SUB_CUISINES[Math.floor(Math.random() * CHINESE_SUB_CUISINES.length)];
    }
    
    return { cuisine: randomCuisine, subCuisine: randomSub };
  }, [history.length, recommendationSeed]); // Refresh recommendation when history changes or seed updates

  const saveToHistory = async (recipe: Recipe) => {
    try {
      const newHistory = [recipe, ...history].slice(0, 100);
      setHistory(newHistory);
      await apiService.saveHistory(recipe);
    } catch (err) {
      console.error("同步历史记录失败:", err);
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleGenerate = async (
    extraExcluded: string[] = [],
    customInput?: string,
    customPrefs?: UserPreferences,
  ) => {
    const targetInput = customInput || input;
    if (!targetInput.trim() && !customInput) return;

    setLoading(true);
    setError(null);
    setCurrentRecipe(null);

    try {
      // 1. 尝试从数据库推荐（如果是简单的食材/菜名搜索）
      const isSimpleKeyword = targetInput.length <= 10 && !targetInput.includes('，') && !targetInput.includes(',');
      
      if (isSimpleKeyword) {
        try {
          console.log(`🔍 尝试从数据库搜索: ${targetInput}`);
          setSoulIngredient(targetInput);  // 🆕 记录灵魂料理关键词
          const recipe = await apiService.getRecommendation(
            'peter_yong',
            prefs.diners,
            [],
            excludedDishNames,
            targetInput  // 传递关键词
          );
          setCurrentRecipe(recipe);
          setIsNewRecipe(true);
          setIsRecommendationMode(true);  // 标记为推荐模式
          showToast('✨ 从本地菜谱库为您精选！');
          return;
        } catch (err: any) {
          console.warn('数据库推荐失败，降级到AI生成:', err.message);
          // 继续执行AI生成逻辑
        }
      }
      
      // 2. 如果数据库没找到，或者是复杂查询，调用AI生成
      if (!customInput) {
        setIsRecommendationMode(false); // Reset if it's a manual search
      }
      
      // Logic fix: Strictly exclude meals from the past 7 days
      const lastWeek = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentTitles = history
        .filter((r) => r.createdAt > lastWeek)
        .map((r) => r.title);

      // 重要：把当前正在显示的菜名也加入临时排除，防止连续点击大按钮时重复
      const currentTitle = currentRecipe?.title;
      const allExcluded = [...new Set([
        ...recentTitles, 
        ...sessionDisliked, 
        ...(currentTitle ? [currentTitle] : []), 
        ...extraExcluded,
        ...excludedDishNames  // 新增：加入排除的菜名列表
      ])];
      
      console.log('🚫 排除列表:', allExcluded);
      
      const recipe = await generateRecipe(
        targetInput || "大厨绝活推荐",
        customPrefs || prefs,
        allExcluded,
        tasteProfile,
      );
      setCurrentRecipe(recipe);
      setIsNewRecipe(true); // 新生成的菜谱
    } catch (err: any) {
      console.error("AI Generation Error:", err);
      const errorMsg = err.message || "未知错误";
      setError(`糟了！厨房起火了：${errorMsg.includes('JSON') ? 'AI 返回了格式错误的数据' : '网络或 API 异常'}。请点击刷新再次挑战！`);
    } finally {
      setLoading(false);
    }
  };

  const handleRecommend = async () => {
    setSoulIngredient('');  // 🆕 清除灵魂料理上下文
    setIsRecommendationMode(true);
    // 不再清空 sessionDisliked，保留之前排除的菜品
    setLoading(true);
    setError(null);
    setCurrentRecipe(null);

    try {
      // 调用本地推荐 API 而非 AI 生成
      const recipe = await apiService.getRecommendation(
        'peter_yong',
        prefs.diners,
        [],
        excludedDishNames,
        '',          // keyword为空（不指定搜索关键词）
        true         // 🆕 randomMode = true（启用随机推荐）
      );
      setCurrentRecipe(recipe);
      setIsNewRecipe(true);
      
      // 推荐成功后，将新推荐的菜品ID和其所有单菜ID都加入排除列表
      const dishIds = recipe.dishes.map(d => d.id).filter(Boolean) as string[];
      const newDisliked = [...new Set([...sessionDisliked, recipe.id, ...dishIds])];
      setSessionDisliked(newDisliked);
    } catch (err: any) {
      console.error('推荐失败:', err);
      setError(`推荐失败：${err.message}。请确保后端服务已启动且有足够的基础菜谱数据。`);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async () => {
    if (currentRecipe) {
      try {
        // 1. 记录用户反馈（触发权重更新）
        await apiService.recordFeedback('peter_yong', currentRecipe.id, 'like', currentRecipe);
        
        // 2. 保存到收藏
        const updated = [currentRecipe, ...savedRecipes];
        setSavedRecipes(updated);
        await apiService.saveRecipe(currentRecipe);
        
        // 3. 保存到历史
        saveToHistory(currentRecipe);
        
        // 4. 如果是AI生成的，异步保存单菜到base_recipes
        apiService.saveToBaseRecipes(currentRecipe)
          .then(result => {
            console.log(`✅ 已将 ${result.savedCount}/${result.totalDishes} 道菜保存到基础菜谱库`);
            if (result.errors && result.errors.length > 0) {
              console.warn('部分菜品保存失败:', result.errors);
            }
          })
          .catch(err => {
            console.warn('保存到基础菜谱库失败（不影响收藏）:', err);
          });
        
        setIsNewRecipe(false); // 保存后进入查看模式
        showToast('🚀 料理已存入你的私人禁地！权重已更新，已加入推荐库');
      } catch (err) {
        console.error("保存失败:", err);
        showToast('❌ 保存失败，请检查数据库连接');
      }
    }
  };

  const handleDislike = async () => {
    if (currentRecipe) {
      try {
        // 1. 记录用户反馈（触发权重更新）
        await apiService.recordFeedback('peter_yong', currentRecipe.id, 'dislike', currentRecipe);
        
        // 2. 提取所有单菜名称并加入排除列表
        const dishNames = currentRecipe.dishes.map(d => d.name);
        const newExcludedNames = [...new Set([...excludedDishNames, ...dishNames])];
        setExcludedDishNames(newExcludedNames);
        
        console.log('🚫 已排除菜品:', newExcludedNames);
        
        // 3. 重新推荐
        if (isRecommendationMode) {
          // 推荐模式：调用后端API（传递菜名列表）
          setLoading(true);
          try {
            const recipe = await apiService.getRecommendation(
              'peter_yong', 
              prefs.diners, 
              [],  // ID列表留空
              newExcludedNames,  // 传递菜名列表
              soulIngredient,  // 🔧 修复：只在有灵魂料理上下文时传递关键词，否则为空（随机推荐）
              !soulIngredient  // 🆕 没有灵魂料理时使用随机模式
            );
            setCurrentRecipe(recipe);
            setIsNewRecipe(true);
          } catch (err: any) {
            console.error('推荐失败:', err);
            // 如果是候选池为空的错误，提示用户
            if (err.message && err.message.includes('没有找到')) {
              setError('数据库中没有更多符合条件的菜品了，建议：\n1. 点击"蔡大厨，上菜！"尝试随机推荐\n2. 或者搜索其他食材');
            } else {
              setError(`推荐失败：${err.message}`);
            }
          } finally {
            setLoading(false);
          }
        } else {
          // 自定义搜索模式：重新生成AI（同样传递菜名和关键词）
          handleGenerate(newExcludedNames, soulIngredient || input);  // 🆕 传递灵魂料理关键词
        }
      } catch (err) {
        console.error('反馈记录失败:', err);
        showToast('❌ 反馈记录失败');
      }
    }
  };

  const removeSaved = (id: string) => {
    const updated = savedRecipes.filter((r) => r.id !== id);
    setSavedRecipes(updated);
    localStorage.setItem(STORAGE_KEYS.SAVED_RECIPES, JSON.stringify(updated));
    if (viewingSavedRecipe && viewingSavedRecipe.id === id) {
      setViewingSavedRecipe(null); // If the currently viewed recipe is removed, close the detail view
    }
  };

  // 退出登录处理
  const handleLogout = () => {
    setIsLoggedIn(false);
    sessionStorage.removeItem('isLoggedIn');
    // 重置必要状态
    setLoginInput('');
    setActiveTab('generate');
  };

  // --- 登录视图拦截点 (必须在所有 Hook 之后) ---
  const fetchMoreRecipes = async () => {
    if (isFetchingMore || !hasMore) return;
    setIsFetchingMore(true);
    try {
      const nextPage = page + 1;
      const moreRecipes = await apiService.getSavedRecipes(nextPage, PAGE_LIMIT);
      
      if (moreRecipes.length < PAGE_LIMIT) {
        setHasMore(false);
      }
      
      setSavedRecipes(prev => [...prev, ...moreRecipes]);
      setPage(nextPage);
    } catch (err) {
      console.error("加载更多失败:", err);
      showToast("❌ 翻找失败，蔡大厨手滑了");
    } finally {
      setIsFetchingMore(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="fixed inset-0 min-h-screen bg-[#F4D03F] flex items-center justify-center p-6 font-mono selection:bg-black selection:text-[#F4D03F] z-50 overflow-auto">
        <div className="w-full max-w-md animate-in zoom-in duration-500">
          <NeoCard color="bg-white" className="p-12 border-[8px]">
            <div className="text-center space-y-8">
              <div className="inline-block bg-black text-white px-4 py-2 font-black text-4xl transform -rotate-2 border-4 border-black mb-4">
                STOP！🛑
              </div>
              <h1 className="text-3xl font-black leading-tight uppercase tracking-tighter">
                蔡大厨的私人后厨<br/>
                <span className="text-[#FF5722] underline decoration-8">PRIVATE KITCHEN</span>
              </h1>
              
              <div className="space-y-4">
                <p className="font-black text-lg underline">请输入准入暗语以开动：</p>
                <input
                  type="text"
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="在此输入暗号..."
                  className={`w-full border-[6px] border-black p-4 text-2xl font-black bg-yellow-50 outline-none transition-all ${
                    loginError ? 'bg-red-200 translate-x-1' : 'focus:bg-white focus:-translate-y-1 focus:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]'
                  }`}
                />
                {loginError && (
                  <p className="text-red-600 font-black text-sm italic animate-bounce">
                    🚫 暗号不对，大厨拒绝上菜！
                  </p>
                )}
              </div>

              <NeoButton
                variant="primary"
                className="w-full text-2xl py-6"
                onClick={handleLogin}
              >
                立即开饭 →
              </NeoButton>
              
              <p className="text-[10px] font-black opacity-30 pt-4 uppercase">
                AUTHENTICATION REQUIRED • NO PASS NO FOOD • TRUST THE CHEF
              </p>
            </div>
          </NeoCard>
          
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto space-y-10 relative">
      {/* 退出登录按钮 */}
      <div className="absolute top-4 right-4 md:top-8 md:right-8 z-10">
        <button
          onClick={handleLogout}
          className="bg-[#FF1744] text-white border-4 border-black px-4 py-2 font-black text-sm uppercase tracking-widest neo-shadow-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
        >
          在下告退
        </button>
      </div>

      <header className="flex flex-col md:flex-row items-center justify-between gap-8 pt-4">
        <div
          className="relative cursor-pointer"
          onClick={() => setActiveTab("generate")}
        >
          <div className="flex flex-col items-center md:items-start">
            <div className="flex items-center gap-3">
              <h1 className="text-5xl md:text-8xl font-black bg-[#FF5722] text-white inline-block p-4 border-[8px] border-black neo-shadow-lg transform -rotate-2 hover:rotate-0 transition-all">
                今天吃什么呢
              </h1>
            </div>
            <div className="mt-4 bg-[#FFEB3B] border-4 border-black px-4 py-2 neo-shadow font-black text-sm md:text-lg flex items-center gap-2">
              <span className="star">★</span>{" "}
              {isAnalyzing
                ? "正在同步味蕾数据..."
                : `美食人格：${tasteProfile}`}
            </div>
          </div>
        </div>

        <nav className="flex border-[6px] border-black neo-shadow-lg bg-white rounded-2xl">
          <button
            onClick={() => setActiveTab("generate")}
            className={`px-10 py-5 font-black text-xl uppercase tracking-tighter transition-all whitespace-nowrap rounded-l-[10px] ${activeTab === "generate" ? "bg-[#4CAF50] text-white underline underline-offset-8 decoration-4" : "hover:bg-gray-100"}`}
          >
            去探险
          </button>
          <button
            onClick={() => { setActiveTab('cookbook'); setViewingSavedRecipe(null); }}
            className={`px-10 py-5 font-black text-xl uppercase tracking-tighter transition-all border-l-[6px] border-black whitespace-nowrap rounded-r-[10px] ${activeTab === 'cookbook' ? 'bg-[#9C27B0] text-white underline underline-offset-8 decoration-4' : 'hover:bg-gray-100'}`}
          >
            我的地盘
          </button>
        </nav>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-[#00E676] border-[4px] border-black px-8 py-4 neo-shadow-lg font-black text-xl flex items-center gap-3">
             <span className="text-2xl">✨</span> {toast}
          </div>
        </div>
      )}

      {activeTab === 'generate' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 animate-in fade-in zoom-in-95 duration-500">
          <div className="lg:col-span-4 space-y-10">
            {/* Recommendation Card with Marquee */}
            <NeoCard
              title="蔡大厨推荐"
              color="bg-[#9C27B0] text-white"
              hasMarquee={true}
              className="border-pink-300"
            >
              <div className="space-y-4 pt-4">
                <p className="font-black text-lg leading-tight italic">
                  今日盲盒：【{recommendationBase.cuisine}{recommendationBase.subCuisine !== '不限' ? `·${recommendationBase.subCuisine}` : ''}】！蔡大厨已就位，准备好迎接惊喜了吗？
                </p>
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs font-black uppercase text-black bg-[#00E676] px-2 py-1 border-2 border-black rotate-2">
                    一周不重样
                  </span>
                  <span className="text-xs font-black uppercase text-white bg-[#FF5722] px-2 py-1 border-2 border-black -rotate-2">
                    主厨严选
                  </span>
                </div>
                <NeoButton
                  onClick={handleRecommend}
                  variant="primary"
                  className="w-full text-black hover:scale-105"
                  disabled={loading}
                >
                  {loading ? "锅铲冒烟了..." : "蔡大厨，上菜！ →"}
                </NeoButton>
              </div>
            </NeoCard>

            <NeoCard title="定制私人晚餐" color="bg-[#4CAF50] text-white">
              <div className="space-y-6">
                <div>
                  <label className="block font-black text-xl mb-2 text-yellow-300 drop-shadow-md">告诉我你想吃什么：</label>
                  <textarea 
                    rows={3}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="例如：猪肉，希望能做成超辣的川菜风格..."
                    className="w-full hand-drawn-input p-4 font-black text-black text-lg bg-white focus:outline-none resize-none"
                  />
                  <p className="mt-2 text-white/70 text-xs font-black italic">提示：你可以直接输入“五花肉，微甜，粤菜”</p>
                </div>

                <div className="flex items-center gap-6 bg-black/10 p-4 border-4 border-black/20 rounded-xl">
                  <label className="font-black text-xl whitespace-nowrap">吃饭人数：</label>
                  <input 
                    type="number" min="1" max="10"
                    value={prefs.diners}
                    onChange={(e) => setPrefs({...prefs, diners: parseInt(e.target.value) || 1})}
                    className="w-32 hand-drawn-input p-3 font-black text-black bg-white text-center text-2xl"
                  />
                </div>

                <NeoButton
                  onClick={() => { handleGenerate([]); }}
                  disabled={loading || (!input && activeTab === "generate")}
                  variant="orange"
                  className="w-full mt-4 whitespace-nowrap"
                  size="lg"
                >
                  {loading ? "正在创作中..." : "注入灵魂料理！ 🔥"}
                </NeoButton>
              </div>
            </NeoCard>
          </div>

          <div className="lg:col-span-8">
            {error && (
              <NeoCard
                color="bg-[#FF1744]"
                className="mb-6 text-white font-black animate-bounce"
              >
                {error}
              </NeoCard>
            )}

            {loading && (
              <div className="h-[500px] flex flex-col items-center justify-center space-y-8 bg-white/20 border-[8px] border-black rounded-3xl neo-shadow-lg">
                <div className="relative">
                  <div className="absolute -top-16 left-4 animate-sizzle text-5xl">
                    🔥
                  </div>
                  <div
                    className="absolute -top-24 left-16 animate-sizzle text-5xl"
                    style={{ animationDelay: "0.2s" }}
                  >
                    ♨️
                  </div>
                  <div
                    className="absolute -top-20 left-28 animate-sizzle text-5xl"
                    style={{ animationDelay: "0.4s" }}
                  >
                    🌶️
                  </div>
                  <div
                    className="absolute -top-28 left-40 animate-sizzle text-5xl"
                    style={{ animationDelay: "0.1s" }}
                  >
                    🥦
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-[120px] transform -scale-x-100 hover:rotate-12 transition-transform">
                      👨‍🍳
                    </div>
                    <div className="text-[120px] animate-fry origin-bottom drop-shadow-2xl">
                      🍳
                    </div>
                  </div>
                </div>
                <div className="text-center space-y-4">
                  <p className="text-5xl font-black tracking-tighter text-black uppercase italic">
                    蔡大厨疯狂颠勺中...
                  </p>
                  <p className="text-2xl font-black bg-black text-yellow-400 px-6 py-2 border-4 border-black inline-block rotate-1">
                    “这一口，能让你看到星辰大海！”
                  </p>
                </div>
              </div>
            )}

            {!loading &&
              !currentRecipe &&
              !error &&
              activeTab === "generate" && (
                <div className="h-full flex items-center justify-center p-12 border-[8px] border-dashed border-black/30 rounded-3xl bg-white/30">
                  <div className="text-center">
                    <div className="text-[140px] mb-8 animate-pulse grayscale">
                      🥘
                    </div>
                    <p className="text-3xl font-black text-black opacity-60 uppercase tracking-tighter leading-tight italic">
                      美食的大门尚未开启...
                      <br />
                      输入你的渴望，或者接受蔡大厨的挑战！
                    </p>
                  </div>
                </div>
              )}

            {currentRecipe && (
              <div className="space-y-8 animate-in slide-in-from-bottom-12 duration-700">
                <NeoCard color="bg-white">
                  <div className="flex flex-col md:flex-row justify-between items-start gap-6 mb-10 border-b-[8px] border-black pb-8">
                    <div>
                      <h2 className="text-4xl md:text-6xl font-black underline decoration-[#FF5722] decoration-[12px] underline-offset-8 mb-4">
                        {currentRecipe.title}
                      </h2>
                      <div className="flex flex-wrap gap-3">
                        <span className="bg-black text-white px-4 py-2 text-sm md:px-6 md:py-4 md:text-2xl lg:text-xl font-black uppercase tracking-tight rotate-2">
                          {currentRecipe.cuisine}
                        </span>
                        <span className="bg-[#4CAF50] border-4 border-black px-4 py-2 text-sm font-black text-white -rotate-1">
                          {currentRecipe.diners} 人战斗套餐
                        </span>
                        {currentRecipe.tags.map((tag) => (
                          <span
                            key={tag}
                            className="border-4 border-black px-4 py-2 text-sm font-black bg-yellow-200 italic hover:scale-110 transition-transform"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    {isNewRecipe && (
                      <div className="flex flex-col gap-3 w-full md:w-auto">
                        <NeoButton
                          variant="success"
                          className="w-full text-black"
                          onClick={handleLike}
                        >
                          完美！我要开饭了
                        </NeoButton>
                        <NeoButton
                          variant="danger"
                          className="w-full"
                          onClick={handleDislike}
                        >
                          不对劲，换个绝活
                        </NeoButton>
                      </div>
                    )}
                  </div>

                  <div className="space-y-16">
                    {currentRecipe.dishes.map((dish, idx) => (
                      <div
                        key={idx}
                        className="border-[6px] border-black p-6 md:p-10 neo-shadow bg-[#FFF7E1] relative"
                      >
                        <div className="absolute -top-8 left-4 bg-[#FF5722] text-white font-black text-2xl px-6 py-2 border-4 border-black transform -rotate-2">
                          料理 {idx + 1}: {dish.name}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-4">
                          <div className="space-y-4">
                            <h4 className="font-black text-2xl mb-4 text-black border-b-4 border-black pb-2 flex items-center gap-2">
                              🛒 战斗补给：
                            </h4>
                            <ul className="space-y-3">
                              {dish.ingredients.map((ing, i) => (
                                <li
                                  key={i}
                                  className="flex justify-between items-center border-b-2 border-black/10 border-dashed pb-2"
                                >
                                  <span className="font-black text-lg">
                                    {ing.name}
                                  </span>
                                  <span className="font-black bg-black text-white px-2 py-1 text-xs">
                                    {ing.amount}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-4">
                            <h4 className="font-black text-2xl mb-4 text-black border-b-4 border-black pb-2 flex items-center gap-2">
                              🛠️ 征服过程：
                            </h4>
                            <div className="space-y-5">
                              {dish.instructions.map((step) => (
                                <div
                                  key={step.step}
                                  className="flex gap-4 group"
                                >
                                  <div className="bg-black text-white w-8 h-8 flex-shrink-0 flex items-center justify-center font-black text-lg group-hover:rotate-12 transition-transform">
                                    {step.step}
                                  </div>
                                  <p className="font-black text-base leading-snug italic text-gray-800">
                                    {step.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <NeoCard
                      color="bg-[#4CAF50] text-white"
                      className="p-8 border-white/30"
                    >
                      <h3 className="font-black text-2xl mb-4 flex items-center gap-3">
                        💡 蔡大厨的能量补给包：
                      </h3>
                      <p className="font-black text-lg leading-relaxed italic">
                        “{currentRecipe.nutritionInfo}”
                      </p>
                    </NeoCard>
                  </div>
                </NeoCard>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-12 animate-in fade-in slide-in-from-right-10 duration-500">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <NeoCard
              color="bg-[#9C27B0] text-white"
              className="md:col-span-1 border-pink-400"
            >
              <h3 className="text-3xl font-black mb-4 flex items-center gap-2 underline">
                我的探险等级
              </h3>
              <p className="font-black text-2xl leading-tight italic">
                “{tasteProfile}”
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="bg-white text-black text-xs font-black px-3 py-1 border-2 border-black">
                  已征服 {savedRecipes.length} 道料理
                </span>
              </div>
            </NeoCard>
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-8">
              <NeoCard title="我的派系领地" color="bg-white">
                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const stats = savedRecipes.reduce((acc, curr) => {
                      acc[curr.cuisine] = (acc[curr.cuisine] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>);
                    
                    return Object.entries(stats)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5) // 仅显示前 5 名
                      .map(([cuisine, count]) => (
                        <div key={cuisine} className="border-4 border-black px-4 py-2 bg-yellow-400 font-black text-lg shadow-inner">
                          {cuisine} x{count}
                        </div>
                      ));
                  })()}
                </div>
              </NeoCard>
              <NeoCard title="战斗勋章" color="bg-white">
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const tagStats = savedRecipes.flatMap(r => r.tags).reduce((acc, tag) => {
                      acc[tag] = (acc[tag] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>);

                    return Object.entries(tagStats)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 12) // 固定显示前 12 个最热门标签
                      .map(([tag]) => (
                        <div key={tag} className="border-2 border-black px-3 py-1 bg-pink-100 font-black text-xs uppercase tracking-tighter">
                          #{tag}
                        </div>
                      ));
                  })()}
                </div>
              </NeoCard>
            </div>
          </section>

          <NeoCard title={viewingSavedRecipe ? `查看计划：${viewingSavedRecipe.title}` : "我的美味地窖"} color="bg-white">
             {viewingSavedRecipe ? (
               <div className="space-y-8 animate-in slide-in-from-bottom-12 duration-700">
                 <div className="flex justify-between items-center border-b-4 border-black pb-4">
                   <NeoButton onClick={() => setViewingSavedRecipe(null)} variant="primary">← 返回地窖</NeoButton>
                   <span className="font-black text-xl bg-[#FFEB3B] px-4 py-2 border-2 border-black rotate-1">
                     {new Date(viewingSavedRecipe.createdAt).toLocaleDateString()} 的美食记忆
                   </span>
                 </div>
                 
                 <div className="space-y-16">
                   <div className="flex flex-wrap gap-3">
                     <span className="bg-black text-white px-4 py-2 text-sm font-black uppercase">{viewingSavedRecipe.cuisine}</span>
                     <span className="bg-[#4CAF50] border-4 border-black px-4 py-2 text-sm font-black text-white">{viewingSavedRecipe.diners} 人套餐</span>
                     {viewingSavedRecipe.tags.map(tag => (
                       <span key={tag} className="border-4 border-black px-4 py-2 text-sm font-black bg-yellow-200">#{tag}</span>
                     ))}
                   </div>

                   {viewingSavedRecipe.dishes.map((dish, idx) => (
                     <div key={idx} className="border-[6px] border-black p-6 md:p-10 neo-shadow bg-[#FFF7E1] relative">
                       <div className="absolute -top-8 left-4 bg-[#FF5722] text-white font-black text-2xl px-6 py-2 border-4 border-black transform -rotate-2">
                         料理 {idx + 1}: {dish.name}
                       </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-4">
                         <div className="space-y-4">
                           <h4 className="font-black text-2xl mb-4 text-black border-b-4 border-black pb-2 flex items-center gap-2">🛒 战斗补给：</h4>
                           <ul className="space-y-3">
                             {dish.ingredients.map((ing, i) => (
                               <li key={i} className="flex justify-between items-center border-b-2 border-black/10 border-dashed pb-2">
                                 <span className="font-black text-lg">{ing.name}</span>
                                 <span className="font-black bg-black text-white px-2 py-1 text-xs">{ing.amount}</span>
                               </li>
                             ))}
                           </ul>
                         </div>
                         <div className="space-y-4">
                           <h4 className="font-black text-2xl mb-4 text-black border-b-4 border-black pb-2 flex items-center gap-2">🛠️ 征服过程：</h4>
                           <div className="space-y-5">
                             {dish.instructions.map((step) => (
                               <div key={step.step} className="flex gap-4 group">
                                 <div className="bg-black text-white w-8 h-8 flex-shrink-0 flex items-center justify-center font-black text-lg">
                                   {step.step}
                                 </div>
                                 <p className="font-black text-base leading-snug italic text-gray-800">{step.description}</p>
                               </div>
                             ))}
                           </div>
                         </div>
                       </div>
                     </div>
                   ))}

                   <NeoCard color="bg-[#4CAF50] text-white" className="p-8 border-white/30">
                     <h3 className="font-black text-2xl mb-4 flex items-center gap-3">💡 蔡大厨的能量补给包：</h3>
                     <p className="font-black text-lg leading-relaxed italic">“{viewingSavedRecipe.nutritionInfo}”</p>
                   </NeoCard>
                 </div>
               </div>
             ) : savedRecipes.length === 0 ? (
               <div className="text-center py-32 opacity-30">
                 <p className="text-[120px] mb-8 grayscale">🏚️</p>
                 <p className="font-black text-3xl uppercase">地窖空空如也，快去探险！</p>
               </div>
              ) : (
                <div className="space-y-16">
                  {(() => {
                    // 按日期分组
                    const grouped = savedRecipes.reduce((acc, recipe) => {
                      const dateStr = new Date(recipe.createdAt).toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      });
                      if (!acc[dateStr]) acc[dateStr] = [];
                      acc[dateStr].push(recipe);
                      return acc;
                    }, {} as Record<string, Recipe[]>);

                    // 日期降序排列
                    const sortedDates = Object.keys(grouped).sort((a, b) => {
                      // 这里使用各组最新一条的时间进行排序
                      return grouped[b][0].createdAt - grouped[a][0].createdAt;
                    });

                    return (
                      <>
                        <div className="space-y-16">
                          {sortedDates.map(date => (
                            <div key={date} className="space-y-8">
                              <div className="flex items-center gap-4">
                                <h4 className="bg-black text-white px-6 py-2 font-black text-xl border-4 border-black inline-block skew-x-[-3deg]">
                                  {date}
                                </h4>
                                <div className="h-1 flex-grow bg-black/10"></div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {grouped[date].map(recipe => (
                                  <div 
                                    key={recipe.id} 
                                    onClick={() => setViewingSavedRecipe(recipe)}
                                    className="border-[6px] border-black p-8 neo-shadow hover:-translate-y-2 transition-transform bg-white group cursor-pointer relative overflow-hidden"
                                  >
                                    <div className="flex flex-col h-full justify-between">
                                      <div>
                                        <h4 className="text-2xl font-black group-hover:underline underline-offset-4 decoration-4 decoration-[#FF5722] mb-4">
                                          {recipe.title}
                                        </h4>
                                        <div className="flex flex-wrap gap-1 mb-6">
                                          {recipe.dishes.map(d => (
                                            <span key={d.name} className="text-[10px] font-black bg-gray-100 border border-black px-2 py-0.5">{d.name}</span>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="flex justify-between items-center pt-6 border-t-2 border-black/10">
                                        <div className="flex flex-col">
                                          <span className="font-black text-xs text-blue-600 uppercase tracking-widest">{recipe.cuisine}</span>
                                          <span className="font-black text-xs">{recipe.diners}人餐</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        {hasMore && (
                          <div className="mt-16 text-center">
                            <NeoButton
                              variant="primary"
                              size="lg"
                              onClick={fetchMoreRecipes}
                              disabled={isFetchingMore}
                              className="px-12 py-6 text-2xl"
                            >
                              {isFetchingMore ? (
                                <span className="flex items-center gap-3">
                                  <span className="animate-spin text-3xl">🍲</span> 大厨正在翻找陈年秘籍...
                                </span>
                              ) : "展开更多陈年美味 ↓"}
                            </NeoButton>
                          </div>
                        )}
                        
                        {!hasMore && savedRecipes.length > 0 && (
                          <div className="mt-16 text-center opacity-30 select-none">
                            <p className="font-black text-xl italic">— 到头了，地窖底部的尘埃在向你致意 —</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
          </NeoCard>
        </div>
      )}

    </div>
  );
};

export default App;
