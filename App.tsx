import React, { useState, useEffect, useMemo } from "react";
import NeoButton from "./components/NeoButton";
import NeoCard from "./components/NeoCard";
import FocusCookingMode from "./components/FocusCookingMode";
import { generateRecipe, analyzeUserTaste } from "./services/geminiService";
import { apiService } from "./services/apiService";
import {
  Recipe,
  UserPreferences,
  CuisineType,
  ChineseSubCuisine,
  FamilyMember,
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
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>(() => {
    // 初始依然可以带上本地缓存作为兜底，避免白屏等待
    const saved = localStorage.getItem(STORAGE_KEYS.FAMILY_MEMBERS);
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [newMember, setNewMember] = useState<Partial<FamilyMember>>({ name: '', preferences: '' });
  const [focusRecipe, setFocusRecipe] = useState<Recipe | null>(null);
  const PAGE_LIMIT = 20;

  // 监听并保存家庭成员变化（同时保存到云端和本地）
  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.FAMILY_MEMBERS, JSON.stringify(familyMembers));
    apiService.saveFamilyMembers('peter_yong', familyMembers).catch(err => {
      console.error('云端同步家庭成员失败:', err);
    });
  }, [familyMembers, isLoggedIn]);

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
          
          // 顺带拉取云端家庭成员配置
          try {
            const profile = await apiService.getUserProfile('peter_yong');
            if (profile.familyMembers && Array.isArray(profile.familyMembers)) {
               setFamilyMembers(profile.familyMembers);
            }
          } catch (err) {
            console.error('拉取云端家人配置失败:', err);
          }
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
      
      // 🆕 获取选中家庭成员的偏好
      const selectedMembersPrefs = familyMembers
        .filter(m => selectedMembers.includes(m.id))
        .map(m => `成员[${m.name}]的偏好/忌口：${m.preferences}`)
        .join('；');

      const familyContext = selectedMembersPrefs 
        ? `。特别注意今天以下家人的要求：${selectedMembersPrefs}` 
        : '';
        
      const recipe = await generateRecipe(
        (targetInput || "大厨绝活推荐") + familyContext,
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
      <div className="fixed inset-0 min-h-screen bg-[#FFFBF0] flex items-center justify-center p-6 font-sans selection:bg-[#FF8A65] selection:text-white z-50 overflow-auto">
        <div className="w-full max-w-md animate-in zoom-in duration-500">
          <NeoCard color="bg-white" className="p-10">
            <div className="text-center space-y-6">
              <div className="inline-block bg-[#FFB74D] text-[#4E342E] px-5 py-2 rounded-full font-bold text-lg mb-2 shadow-sm">
                🏠 欢迎回厨房
              </div>
              <h1 className="text-3xl font-extrabold text-[#4E342E] leading-tight tracking-tight">
                今天想为家人<br/>
                <span className="text-[#FF8A65]">做点什么？</span>
              </h1>
              
              <div className="space-y-4 pt-4">
                <p className="font-semibold text-[#6D4C41] text-sm">请输入您的专属主厨昵称：</p>
                <input
                  type="text"
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="例如：米其林大厨"
                  className={`w-full hand-drawn-input p-4 text-xl font-bold bg-[#FFF8E1] text-center ${
                    loginError ? 'border-red-400 bg-red-50 translate-x-1' : ''
                  }`}
                />
                <div className="h-6">
                  {loginError && (
                    <p className="text-red-500 font-bold text-sm animate-bounce">
                      提示：昵称不对，检查一下哦！
                    </p>
                  )}
                </div>
              </div>

              <NeoButton
                variant="orange"
                className="w-full text-xl py-4 mt-2"
                onClick={handleLogin}
              >
                系上围裙，开始！🍲
              </NeoButton>
            </div>
          </NeoCard>
          <p className="text-center mt-6 text-[#A1887F] text-xs font-semibold tracking-wider">
            ♡ 为爱下厨 / MADE WITH LOVE ♡
          </p>
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
          className="bg-white/80 backdrop-blur text-[#8D6E63] border-2 border-orange-100/50 px-4 py-2 rounded-full font-bold text-sm shadow-sm hover:bg-white hover:shadow transition-all flex items-center gap-2"
        >
          <span>🚪</span> 退出厨房
        </button>
      </div>

      <header className="flex flex-col md:flex-row items-center justify-between gap-8 pt-4">
        <div
          className="relative cursor-pointer group"
          onClick={() => setActiveTab("generate")}
        >
          <div className="flex flex-col items-center md:items-start text-center md:text-left">
            <h1 className="text-4xl md:text-5xl font-extrabold text-[#4E342E] tracking-tight mb-2 group-hover:text-[#D84315] transition-colors">
              👨‍👩‍👧‍👦 我们的家庭餐桌
            </h1>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-orange-50 border border-orange-100 rounded-full text-[#E65100] font-bold text-sm shadow-sm">
              <span className="star">✨</span>{" "}
              {isAnalyzing
                ? "正在整理家人的口味偏好..."
                : `偏好记忆：${tasteProfile}`}
            </div>
          </div>
        </div>

        <nav className="flex p-1 bg-white border border-gray-100 shadow-sm rounded-2xl">
          <button
            onClick={() => setActiveTab("generate")}
            className={`px-6 py-3 font-bold text-lg transition-all rounded-xl ${
              activeTab === "generate" 
                ? "bg-[#FFB74D] text-[#4E342E] shadow-sm" 
                : "text-gray-500 hover:text-[#4E342E] hover:bg-orange-50"
            }`}
          >
            💡 发现灵感
          </button>
          <button
            onClick={() => { setActiveTab('cookbook'); setViewingSavedRecipe(null); }}
            className={`px-6 py-3 font-bold text-lg transition-all rounded-xl ${
              activeTab === 'cookbook' 
                ? "bg-[#81C784] text-white shadow-sm" 
                : "text-gray-500 hover:text-[#4E342E] hover:bg-green-50"
            }`}
          >
            📖 家庭菜单本
          </button>
        </nav>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 z-[999] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-[#E8F5E9] text-[#2E7D32] border border-[#81C784] px-6 py-3 rounded-2xl shadow-lg font-bold text-lg flex items-center gap-3">
             <span className="text-xl">✨</span> {toast}
          </div>
        </div>
      )}

      {activeTab === 'generate' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in zoom-in-95 duration-500">
          <div className="lg:col-span-5 space-y-6">
            {/* Recommendation Card */}
            <NeoCard
              title="👨‍🍳 主厨今日特供"
              color="bg-white"
              hasMarquee={true}
            >
              <div className="space-y-4 pt-2">
                <p className="font-semibold text-[#6D4C41] text-lg leading-relaxed">
                  不知道吃什么？今天我为您随机准备了一份【<span className="text-[#FF8A65] font-bold">主厨精选</span>】搭配，保证家人喜欢！
                </p>
                <div className="flex gap-2 flex-wrap mb-2">
                  <span className="text-xs font-bold text-[#2E7D32] bg-[#E8F5E9] px-3 py-1 rounded-full border border-[#81C784]">
                    🌱 一周不重样
                  </span>
                  <span className="text-xs font-bold text-[#E65100] bg-[#FFF3E0] px-3 py-1 rounded-full border border-[#FFB74D]">
                    ⭐ 精选搭配
                  </span>
                </div>
                <NeoButton
                  onClick={handleRecommend}
                  variant="orange"
                  className="w-full text-white"
                  disabled={loading}
                >
                  {loading ? "正在准备食材..." : "就吃这个，上菜！ ✨"}
                </NeoButton>
              </div>
            </NeoCard>

            <NeoCard title="📝 今天吃什么自己定" color="bg-white">
              <div className="space-y-5">
                {/* 场景与快捷食材区 */}
                <div className="space-y-3 pb-4 border-b border-orange-100">
                  <div>
                    <span className="text-sm font-bold text-[#8D6E63] block mb-2">🎈 快速场景：</span>
                    <div className="flex flex-wrap gap-2">
                      {['超快手10分钟', '儿童长高餐', '清淡养胃', '下酒好菜', '减脂低卡'].map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setInput(prev => `${tag} `)}
                          className="px-3 py-1 text-sm bg-orange-50 text-[#E65100] border border-orange-200 rounded-full hover:bg-orange-100 transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-bold text-[#8D6E63] block mb-2">🥬 帮我清冰箱：</span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        {icon: '🐔', name: '鸡肉'}, {icon: '🥩', name: '牛肉'}, {icon: '🐟', name: '鱼虾'},
                        {icon: '🥔', name: '土豆'}, {icon: '🍅', name: '番茄'}, {icon: '🥬', name: '青草菜'},
                        {icon: '🥚', name: '鸡蛋'}, {icon: '🍄', name: '菌菇'}, {icon: '🍜', name: '面条'}
                      ].map((item) => (
                        <button
                          key={item.name}
                          onClick={() => setInput(prev => `${prev} ${item.name}`.trim())}
                          className="px-2 py-1.5 text-sm bg-gray-50 text-gray-700 border border-gray-200 rounded-xl hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 transition-all flex items-center gap-1"
                        >
                          <span>{item.icon}</span>
                          <span>{item.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#6D4C41] mb-2">或者告诉主厨你的具体要求：</label>
                  <textarea 
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="例如：稍微有点辣的川菜，或者把以上标签组合..."
                    className="w-full hand-drawn-input p-3 font-semibold text-[#4E342E] bg-[#FFFBF0] focus:outline-none resize-none"
                  />
                </div>

                {/* 家庭成员与人数配置区 */}
                <div className="flex flex-col gap-4 bg-orange-50/50 p-4 rounded-2xl border border-orange-100">
                  {/* 家人选择 */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[#6D4C41]">👨‍👩‍👧 今天谁在家吃饭：</span>
                      <button onClick={() => setShowMemberModal(true)} className="text-xs font-bold text-[#FF8A65] underline hover:text-[#D84315]">管理家人口味</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {familyMembers.map(m => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedMembers(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id])}
                          className={`px-3 py-1.5 text-sm rounded-full font-bold transition-all border ${selectedMembers.includes(m.id) ? 'bg-[#FF8A65] text-white border-[#FF8A65] shadow-sm' : 'bg-white text-[#8D6E63] border-orange-200 hover:bg-orange-50'}`}
                        >
                          {m.name}
                        </button>
                      ))}
                      {familyMembers.length === 0 && <span className="text-xs text-gray-400 mt-1">尚未添加家庭成员</span>}
                    </div>
                  </div>
                  
                  {/* 人数调整 */}
                  <div className="flex items-center gap-4 pt-3 border-t border-orange-100/50">
                    <label className="font-bold text-[#6D4C41] whitespace-nowrap">🍲 预计菜量（人数）：</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPrefs({...prefs, diners: Math.max(1, prefs.diners - 1)})} className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-500 hover:bg-orange-50 font-bold">-</button>
                      <span className="w-8 text-center font-bold text-xl text-[#E65100]">{prefs.diners}</span>
                      <button onClick={() => setPrefs({...prefs, diners: Math.min(10, prefs.diners + 1)})} className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-500 hover:bg-orange-50 font-bold">+</button>
                    </div>
                  </div>
                </div>

                <NeoButton
                  onClick={() => { handleGenerate([]); }}
                  disabled={loading || (!input && activeTab === "generate")}
                  variant="primary"
                  className="w-full mt-2"
                  size="lg"
                >
                  {loading ? "搭配中..." : "为您定制菜单 🪄"}
                </NeoButton>
              </div>
            </NeoCard>
          </div>

          <div className="lg:col-span-7">
            {error && (
              <NeoCard
                color="bg-red-50"
                className="mb-6 text-red-600 font-bold border-red-200"
              >
                {error}
              </NeoCard>
            )}

            {loading && (
              <div className="h-[400px] flex flex-col items-center justify-center space-y-8 bg-white/50 border-2 border-dashed border-orange-200 rounded-3xl neo-shadow-lg">
                <div className="relative">
                  <div className="absolute -top-12 left-2 animate-sizzle text-4xl">✨</div>
                  <div className="absolute -top-20 left-12 animate-sizzle text-4xl" style={{ animationDelay: "0.2s" }}>♨️</div>
                  <div className="absolute -top-16 left-24 animate-sizzle text-4xl" style={{ animationDelay: "0.4s" }}>🥕</div>
                  <div className="absolute -top-24 left-32 animate-sizzle text-4xl" style={{ animationDelay: "0.1s" }}>🥦</div>

                  <div className="flex items-center gap-4">
                    <div className="text-[80px] hover:rotate-6 transition-transform">👩‍🍳</div>
                    <div className="text-[80px] animate-fry origin-bottom drop-shadow-lg">🥘</div>
                  </div>
                </div>
                <div className="text-center space-y-3">
                  <p className="text-2xl font-bold text-[#6D4C41] tracking-wide">
                    稍等，正在搭配最棒的家庭晚餐...
                  </p>
                  <p className="text-sm font-semibold text-orange-600 bg-orange-50 px-4 py-1.5 rounded-full inline-block">
                    “好饭不怕晚，美味即将出锅！”
                  </p>
                </div>
              </div>
            )}

            {!loading &&
              !currentRecipe &&
              !error &&
              activeTab === "generate" && (
                <div className="h-full min-h-[400px] flex items-center justify-center p-12 border-2 border-dashed border-gray-300 rounded-3xl bg-white/30">
                  <div className="text-center">
                    <div className="text-[100px] mb-6 animate-pulse opacity-40 grayscale">
                      🍽️
                    </div>
                    <p className="text-xl font-bold text-gray-400 tracking-wide leading-relaxed">
                      餐桌还空空如也...
                      <br />
                      <span className="text-sm font-normal">点击左侧按钮，或者告诉我今天想吃什么吧！</span>
                    </p>
                  </div>
                </div>
              )}

            {currentRecipe && (
              <div className="space-y-6 animate-in slide-in-from-bottom-12 duration-700">
                <NeoCard color="bg-white">
                  <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-6 border-b-2 border-orange-100 pb-6">
                    <div>
                      <h2 className="text-3xl md:text-4xl font-extrabold text-[#4E342E] mb-3">
                        {currentRecipe.title}
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        <span className="bg-[#FFB74D] text-[#4E342E] px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                          {currentRecipe.cuisine}
                        </span>
                        <span className="bg-[#81C784] text-white px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                          👨‍👩‍👧‍👦 {currentRecipe.diners} 人份
                        </span>
                        {currentRecipe.tags.map((tag) => (
                          <span
                            key={tag}
                            className="bg-orange-50 text-[#E65100] border border-orange-100 px-3 py-1 rounded-full text-sm font-bold"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    {isNewRecipe && (
                      <div className="flex flex-col gap-3 w-full md:w-auto min-w-[140px]">
                        <NeoButton
                          variant="success"
                          className="w-full text-white !py-2 !text-base"
                          onClick={handleLike}
                        >
                          ❤️ 加入家庭菜单
                        </NeoButton>
                        <NeoButton
                          variant="secondary"
                          className="w-full text-white !py-2 !text-base bg-gray-400 hover:bg-gray-500"
                          onClick={handleDislike}
                        >
                          🔄 换一个试试
                        </NeoButton>
                      </div>
                    )}
                  </div>
                  
                  {/* 开启专注烹饪入口 */}
                  <div className="mb-6">
                    <NeoButton 
                      onClick={() => setFocusRecipe(currentRecipe)} 
                      variant="orange" 
                      className="w-full text-lg py-4 flex items-center justify-center gap-2 shadow-sm font-black"
                    >
                      <span>👨‍🍳</span> 
                      开启大字模式开始做这顿饭
                    </NeoButton>
                  </div>

                  {/* 总采购清单 */}
                  <div className="mb-8 bg-[#FFF8E1] rounded-2xl p-6 border border-yellow-200">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-xl text-[#6D4C41] flex items-center gap-2">
                        🛒 总采购清单
                      </h3>
                      <button 
                        onClick={() => {
                          const ingredients = currentRecipe.dishes.flatMap(d => d.ingredients);
                          const grouped = ingredients.reduce((acc, curr) => {
                            if (!acc[curr.name]) acc[curr.name] = [];
                            acc[curr.name].push(curr.amount);
                            return acc;
                          }, {} as Record<string, string[]>);
                          
                          const listText = `【${currentRecipe.title}】采购清单：\n` + 
                            Object.entries(grouped)
                              .map(([name, amounts]) => `- ${name}: ${(amounts as string[]).join(' + ')}`)
                              .join('\n');
                              
                          navigator.clipboard.writeText(listText);
                          showToast('✅ 采购清单已复制到剪贴板，快发给家人代买吧！');
                        }}
                        className="text-sm font-bold text-[#E65100] bg-white px-3 py-1.5 rounded-full border border-orange-200 hover:bg-orange-50 transition-colors shadow-sm active:scale-95"
                      >
                        📄 一键复制去买菜
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {(() => {
                        const allIngredients = currentRecipe.dishes.flatMap(d => d.ingredients);
                        const grouped = allIngredients.reduce((acc, curr) => {
                          if (!acc[curr.name]) acc[curr.name] = [];
                          acc[curr.name].push(curr.amount);
                          return acc;
                        }, {} as Record<string, string[]>);
                        
                        return Object.entries(grouped).map(([name, amounts], idx) => (
                          <div key={idx} className="bg-white p-2 rounded-xl flex flex-col justify-center items-center shadow-sm border border-gray-100 text-center">
                            <span className="font-bold text-[#4E342E] text-[15px]">{name}</span>
                            <span className="text-xs text-gray-500 font-medium mt-1">{(amounts as string[]).join(' + ')}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="space-y-6">
                    {currentRecipe.dishes.map((dish, idx) => (
                      <div
                        key={idx}
                        className="border border-orange-100 rounded-2xl p-6 md:p-8 bg-[#FFFBF0] relative"
                      >
                        <div className="inline-block bg-[#FF8A65] text-white font-bold text-lg px-4 py-1.5 rounded-full mb-4 shadow-sm">
                          🍲 第 {idx + 1} 道菜：{dish.name}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mt-2">
                          <div className="md:col-span-4 space-y-3">
                            <h4 className="font-bold text-lg text-[#6D4C41] flex items-center gap-2">
                              🥕 用料：
                            </h4>
                            <ul className="space-y-2 bg-white/50 p-4 rounded-xl border border-orange-50/50">
                              {dish.ingredients.map((ing, i) => (
                                <li
                                  key={i}
                                  className="flex justify-between items-center border-b border-orange-100/50 pb-2 last:border-0 last:pb-0"
                                >
                                  <span className="font-semibold text-[#4E342E]">
                                    {ing.name}
                                  </span>
                                  <span className="font-medium text-gray-600 text-sm">
                                    {ing.amount}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="md:col-span-8 space-y-3">
                            <h4 className="font-bold text-lg text-[#6D4C41] flex items-center gap-2">
                              🍳 做法步骤：
                            </h4>
                            <div className="space-y-4">
                              {dish.instructions.map((step) => (
                                <div
                                  key={step.step}
                                  className="flex gap-4 group bg-white p-4 rounded-xl shadow-sm border border-orange-50"
                                >
                                  <div className="bg-[#FFB74D] text-[#4E342E] w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-sm mt-0.5">
                                    {step.step}
                                  </div>
                                  <p className="font-semibold text-[#5D4037] leading-relaxed">
                                    {step.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {currentRecipe.nutritionInfo && (
                      <div className="bg-[#E8F5E9] p-6 rounded-2xl border border-[#C8E6C9] mt-6">
                        <h3 className="font-bold text-[#2E7D32] text-lg mb-2 flex items-center gap-2">
                          💡 营养小贴士：
                        </h3>
                        <p className="font-semibold text-[#388E3C] leading-relaxed">
                          {currentRecipe.nutritionInfo}
                        </p>
                      </div>
                    )}
                  </div>
                </NeoCard>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-10 duration-500">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <NeoCard
              color="bg-[#FFF8E1]"
              className="md:col-span-1 border-orange-100"
            >
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2 text-[#4E342E]">
                👑 家庭主厨称号
              </h3>
              <p className="font-semibold text-xl leading-snug text-[#6D4C41]">
                “{tasteProfile}”
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="bg-[#FFB74D] text-[#4E342E] text-sm font-bold px-4 py-1.5 rounded-full shadow-sm">
                  已做过 {savedRecipes.length} 道菜
                </span>
              </div>
            </NeoCard>
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <NeoCard title="⭐ 家人最爱菜系" color="bg-white" className="border-orange-50">
                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const stats = savedRecipes.reduce((acc, curr) => {
                      acc[curr.cuisine] = (acc[curr.cuisine] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>);
                    
                    return Object.entries(stats)
                      .sort((a, b) => (b[1] as number) - (a[1] as number))
                      .slice(0, 5) // 仅显示前 5 名
                      .map(([cuisine, count]) => (
                        <div key={cuisine} className="border border-orange-100 px-4 py-2 rounded-xl bg-orange-50 text-[#E65100] font-bold text-md shadow-sm">
                          {cuisine} <span className="text-orange-300 ml-1">x{count}</span>
                        </div>
                      ));
                  })()}
                </div>
              </NeoCard>
              <NeoCard title="🔖 主厨小成就" color="bg-white" className="border-green-50">
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const tagStats = savedRecipes.flatMap(r => r.tags).reduce((acc, tag) => {
                      acc[tag] = (acc[tag] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>);

                    return Object.entries(tagStats)
                      .sort((a, b) => (b[1] as number) - (a[1] as number))
                      .slice(0, 12) // 固定显示前 12 个最热门标签
                      .map(([tag]) => (
                        <div key={tag} className="border border-green-200 px-3 py-1 bg-green-50 text-[#2E7D32] text-sm font-bold rounded-full">
                          #{tag}
                        </div>
                      ));
                  })()}
                </div>
              </NeoCard>
            </div>
          </section>

          <NeoCard title={viewingSavedRecipe ? `美味记忆：${viewingSavedRecipe.title}` : ""} color="bg-transparent" className="!p-0 !border-none !shadow-none">
             {viewingSavedRecipe ? (
               <div className="space-y-6 animate-in slide-in-from-bottom-12 duration-700">
                 <div className="flex justify-between items-center border-b-2 border-orange-100 pb-4 bg-white p-6 rounded-2xl shadow-sm">
                   <NeoButton onClick={() => setViewingSavedRecipe(null)} variant="primary" className="!py-2 bg-orange-50 text-[#E65100] border-orange-200">
                     ← 返回菜单本
                   </NeoButton>
                   <span className="font-bold text-sm text-[#8D6E63] bg-orange-50 px-4 py-2 rounded-full">
                     📅 {new Date(viewingSavedRecipe.createdAt).toLocaleDateString()} 的美好记忆
                   </span>
                 </div>
                 
                 <div className="space-y-6 bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-orange-50">
                   <div className="flex flex-wrap gap-2 mb-6">
                     <span className="bg-[#FFB74D] text-[#4E342E] px-4 py-1.5 rounded-full text-sm font-bold shadow-sm">{viewingSavedRecipe.cuisine}</span>
                     <span className="bg-[#81C784] text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-sm">👨‍👩‍👧‍👦 {viewingSavedRecipe.diners} 人份</span>
                     {viewingSavedRecipe.tags.map(tag => (
                       <span key={tag} className="bg-orange-50 text-[#E65100] border border-orange-100 px-3 py-1.5 rounded-full text-sm font-bold">#{tag}</span>
                     ))}
                   </div>

                    {/* 开启专注烹饪入口 (历史记录页) */}
                    <div className="mb-6">
                      <NeoButton 
                        onClick={() => setFocusRecipe(viewingSavedRecipe)} 
                        variant="orange" 
                        className="w-full text-lg py-4 flex items-center justify-center gap-2 shadow-sm font-black"
                      >
                        <span>👨‍🍳</span> 
                        开启大字模式开始做这顿饭
                      </NeoButton>
                    </div>

                    {/* 总采购清单 (历史记录页) */}
                   <div className="mb-8 bg-[#FFF8E1] rounded-2xl p-6 border border-yellow-200">
                     <div className="flex justify-between items-center mb-4">
                       <h3 className="font-bold text-xl text-[#6D4C41] flex items-center gap-2">
                         🛒 此菜单的总采购清单
                       </h3>
                       <button 
                         onClick={() => {
                           const ingredients = viewingSavedRecipe.dishes.flatMap(d => d.ingredients);
                           const grouped = ingredients.reduce((acc, curr) => {
                             if (!acc[curr.name]) acc[curr.name] = [];
                             acc[curr.name].push(curr.amount);
                             return acc;
                           }, {} as Record<string, string[]>);
                           
                           const listText = `【${viewingSavedRecipe.title}】采购清单：\n` + 
                             Object.entries(grouped)
                               .map(([name, amounts]) => `- ${name}: ${(amounts as string[]).join(' + ')}`)
                               .join('\n');
                               
                           navigator.clipboard.writeText(listText);
                           showToast('✅ 采购清单已复制到剪贴板！');
                         }}
                         className="text-sm font-bold text-[#E65100] bg-white px-3 py-1.5 rounded-full border border-orange-200 hover:bg-orange-50 transition-colors shadow-sm"
                       >
                         📄 复制去买菜
                       </button>
                     </div>
                     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                       {(() => {
                         const allIngredients = viewingSavedRecipe.dishes.flatMap(d => d.ingredients);
                         const grouped = allIngredients.reduce((acc, curr) => {
                           if (!acc[curr.name]) acc[curr.name] = [];
                           acc[curr.name].push(curr.amount);
                           return acc;
                         }, {} as Record<string, string[]>);
                         
                         return Object.entries(grouped).map(([name, amounts], idx) => (
                           <div key={idx} className="bg-white p-2 rounded-xl flex flex-col justify-center items-center shadow-sm border border-gray-100 text-center">
                             <span className="font-bold text-[#4E342E] text-[15px]">{name}</span>
                             <span className="text-xs text-gray-500 font-medium mt-1">{(amounts as string[]).join(' + ')}</span>
                           </div>
                         ));
                       })()}
                     </div>
                   </div>

                   {viewingSavedRecipe.dishes.map((dish, idx) => (
                      <div
                        key={idx}
                        className="border border-orange-100 rounded-2xl p-6 md:p-8 bg-[#FFFBF0] relative"
                      >
                        <div className="inline-block bg-[#FF8A65] text-white font-bold text-lg px-4 py-1.5 rounded-full mb-4 shadow-sm">
                          🍲 第 {idx + 1} 道菜：{dish.name}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mt-2">
                          <div className="md:col-span-4 space-y-3">
                            <h4 className="font-bold text-lg text-[#6D4C41] flex items-center gap-2">
                              🥕 用料：
                            </h4>
                            <ul className="space-y-2 bg-white/50 p-4 rounded-xl border border-orange-50/50">
                              {dish.ingredients.map((ing, i) => (
                                <li
                                  key={i}
                                  className="flex justify-between items-center border-b border-orange-100/50 pb-2 last:border-0 last:pb-0"
                                >
                                  <span className="font-semibold text-[#4E342E]">
                                    {ing.name}
                                  </span>
                                  <span className="font-medium text-gray-600 text-sm">
                                    {ing.amount}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="md:col-span-8 space-y-3">
                            <h4 className="font-bold text-lg text-[#6D4C41] flex items-center gap-2">
                              🍳 做法步骤：
                            </h4>
                            <div className="space-y-4">
                              {dish.instructions.map((step) => (
                                <div
                                  key={step.step}
                                  className="flex gap-4 group bg-white p-4 rounded-xl shadow-sm border border-orange-50"
                                >
                                  <div className="bg-[#FFB74D] text-[#4E342E] w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-sm mt-0.5">
                                    {step.step}
                                  </div>
                                  <p className="font-semibold text-[#5D4037] leading-relaxed">
                                    {step.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                   ))}

                   {viewingSavedRecipe.nutritionInfo && (
                     <div className="bg-[#E8F5E9] p-6 rounded-2xl border border-[#C8E6C9] mt-6">
                       <h3 className="font-bold text-[#2E7D32] text-lg mb-2 flex items-center gap-2">
                         💡 营养小贴士：
                       </h3>
                       <p className="font-semibold text-[#388E3C] leading-relaxed">
                         {viewingSavedRecipe.nutritionInfo}
                       </p>
                     </div>
                   )}
                   
                   <div className="flex justify-end pt-4">
                     <button
                       onClick={() => removeSaved(viewingSavedRecipe.id)}
                       className="text-red-400 hover:text-red-600 font-bold text-sm underline underline-offset-4 transition-colors p-2"
                     >
                       移除此记录
                     </button>
                   </div>
                 </div>
               </div>
             ) : savedRecipes.length === 0 ? (
               <div className="text-center py-24 bg-white rounded-3xl border-2 border-dashed border-orange-100 shadow-sm">
                 <p className="text-[100px] mb-6 opacity-60">📓</p>
                 <p className="font-bold text-xl text-[#8D6E63] tracking-wide">
                   菜单本还是空的哦~
                 </p>
                 <p className="text-gray-400 text-sm mt-2">快去发现并记录你家的私房菜谱吧！</p>
               </div>
              ) : (
                <div className="space-y-12">
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
                      return grouped[b][0].createdAt - grouped[a][0].createdAt;
                    });

                    return (
                      <>
                        <div className="space-y-12">
                          {sortedDates.map(date => (
                            <div key={date} className="space-y-6">
                              <div className="flex items-center gap-4">
                                <h4 className="text-[#E65100] bg-orange-50 border border-orange-100 px-5 py-1.5 rounded-full font-bold text-sm shadow-sm inline-block">
                                  📌 {date}
                                </h4>
                                <div className="h-px flex-grow bg-orange-100"></div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {grouped[date].map(recipe => (
                                  <div 
                                    key={recipe.id} 
                                    onClick={() => setViewingSavedRecipe(recipe)}
                                    className="border border-orange-100 p-6 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-1 transition-all bg-white cursor-pointer relative flex flex-col h-full justify-between"
                                  >
                                    <div>
                                      <h4 className="text-xl font-bold text-[#4E342E] mb-3 leading-tight group-hover:text-[#D84315] transition-colors">
                                        {recipe.title}
                                      </h4>
                                      <div className="flex flex-wrap gap-1.5 mb-4">
                                        {recipe.dishes.map(d => (
                                          <span key={d.name} className="text-xs font-semibold bg-[#FFF8E1] text-[#6D4C41] border border-yellow-100 px-2 py-1 rounded-md">
                                            {d.name}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded">{recipe.cuisine}</span>
                                        <span className="font-medium text-xs text-gray-500">{recipe.diners} 人份</span>
                                      </div>
                                    </div>
                                    <div className="absolute top-4 right-4">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeSaved(recipe.id);
                                        }}
                                        className="text-gray-300 hover:text-red-500 transition-colors p-1 bg-white rounded-full hover:bg-red-50"
                                        title="移除"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        
                        {/* 加载更多按钮 */}
                        {hasMore && (
                          <div className="flex justify-center pt-8 pb-4">
                            <button
                              onClick={fetchMoreRecipes}
                              disabled={isFetchingMore}
                              className="bg-white px-8 py-3 rounded-full font-bold text-[#6D4C41] border border-orange-200 shadow-sm hover:shadow hover:bg-orange-50 hover:text-[#E65100] transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                              {isFetchingMore ? (
                                <>
                                  <span className="animate-spin text-xl">🔥</span> 
                                  正在厨房角落为您翻找...
                                </>
                              ) : (
                                <>
                                  <span className="text-xl">📚</span> 
                                  翻看更老的菜谱
                                </>
                              )}
                            </button>
                          </div>
                        )}
                        {!hasMore && savedRecipes.length > 0 && (
                          <div className="text-center pt-8 pb-4">
                            <p className="text-gray-400 font-medium text-sm">
                              — 已经是所有的家庭料理记忆了 —
                            </p>
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
      
      {/* 添加家庭成员弹窗 */}
      {showMemberModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl relative border border-orange-100">
            <button 
              onClick={() => setShowMemberModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 font-bold text-xl"
            >
              ×
            </button>
            <h3 className="text-xl font-bold text-[#4E342E] mb-6 flex items-center gap-2">👨‍👩‍👧 管理家人口味</h3>
            
            <div className="space-y-4 mb-6 max-h-[40vh] overflow-y-auto pr-2">
              {familyMembers.map(m => (
                <div key={m.id} className="p-3 bg-orange-50/50 border border-orange-100 rounded-2xl flex justify-between items-start gap-4">
                  <div>
                    <div className="font-bold text-[#6D4C41]">{m.name}</div>
                    <div className="text-sm text-gray-500 mt-1">{m.preferences || '无特殊口味'}</div>
                  </div>
                  <button 
                    onClick={() => {
                      setFamilyMembers(prev => prev.filter(fm => fm.id !== m.id));
                      setSelectedMembers(prev => prev.filter(id => id !== m.id));
                    }}
                    className="text-red-400 hover:text-red-600 text-sm font-bold whitespace-nowrap px-2 py-1"
                  >
                    删除
                  </button>
                </div>
              ))}
              {familyMembers.length === 0 && <div className="text-center text-gray-400 text-sm py-4">还未添加任何家庭成员</div>}
            </div>

            <div className="border-t border-orange-100 pt-5 space-y-4">
              <h4 className="font-bold text-[#8D6E63] text-sm">新增家庭成员</h4>
              <input 
                type="text" 
                placeholder="称呼 (如: 老公、女儿、爷爷)" 
                value={newMember.name}
                onChange={e => setNewMember({...newMember, name: e.target.value})}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-orange-300 font-semibold"
              />
              <textarea 
                rows={2}
                placeholder="忌口或偏好 (如: 无辣不欢、不吃胡萝卜和香菜、要软烂)" 
                value={newMember.preferences}
                onChange={e => setNewMember({...newMember, preferences: e.target.value})}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-orange-300 resize-none text-sm"
              />
              <NeoButton 
                onClick={() => {
                  if (!newMember.name?.trim()) {
                    showToast("称呼不能为空哦！");
                    return;
                  }
                  const newEntry: FamilyMember = {
                    id: Date.now().toString(),
                    name: newMember.name.trim(),
                    preferences: newMember.preferences?.trim() || ''
                  };
                  setFamilyMembers([...familyMembers, newEntry]);
                  setSelectedMembers([...selectedMembers, newEntry.id]);
                  setNewMember({name: '', preferences: ''});
                }}
                variant="primary" 
                className="w-full"
              >
                + 加入档案
              </NeoButton>
            </div>
          </div>
        </div>
      )}

      {/* 沉浸式专注烹饪组件（永远在最顶层） */}
      {focusRecipe && (
        <FocusCookingMode 
          recipe={focusRecipe} 
          onClose={() => setFocusRecipe(null)} 
        />
      )}
    </div>
  );
};

export default App;
