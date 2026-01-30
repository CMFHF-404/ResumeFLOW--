// 工作经历卡片管理 Handlers
// 这些函数需要添加到 ExperienceBank 组件中

// 切换卡片展开/折叠状态
const toggleCard = (cardId: string) => {
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(cardId)) {
        newExpanded.delete(cardId);
    } else {
        newExpanded.add(cardId);
        // 展开时初始化卡片数据
        const item = workExperiences.find(e => e.master.id === cardId);
        if (item && !cardData.has(cardId)) {
            const initialData = {
                org: item.latest_version?.org || "",
                title: item.latest_version?.title || "",
                start_date: item.latest_version?.start_date || "",
                end_date: item.latest_version?.end_date || "",
                star: item.latest_version?.star || { s: "", t: "", a: "", r: "" }
            };
            setCardData(new Map(cardData).set(cardId, initialData));
            setOriginalCardData(new Map(originalCardData).set(cardId, JSON.parse(JSON.stringify(initialData))));
        }
    }
    setExpandedCards(newExpanded);
};

// 更新卡片字段值
const updateCardField = (cardId: string, field: string, value: any) => {
    const newData = new Map(cardData);
    const current = newData.get(cardId) || {};

    if (field.startsWith('star.')) {
        const starField = field.split('.')[1];
        current.star = { ...(current.star || {}), [starField]: value };
    } else {
        current[field] = value;
    }

    newData.set(cardId, current);
    setCardData(newData);

    // 检测是否修改
    const original = originalCardData.get(cardId);
    const isModified = original && JSON.stringify(current) !== JSON.stringify(original);
    const newModified = new Set(modifiedCards);
    if (isModified) {
        newModified.add(cardId);
    } else {
        newModified.delete(cardId);
    }
    setModifiedCards(newModified);
};

// 保存卡片
const handleSaveCard = async (cardId: string) => {
    try {
        const data = cardData.get(cardId);
        if (!data) return;

        await experienceService.update(cardId, { version: data });

        // 更新成功后刷新列表
        const updated = await experienceService.list('work');
        setWorkExperiences(updated);

        // 更新原始数据
        setOriginalCardData(new Map(originalCardData).set(cardId, JSON.parse(JSON.stringify(data))));

        // 清除修改标记
        const newModified = new Set(modifiedCards);
        newModified.delete(cardId);
        setModifiedCards(newModified);

        console.log('[ExperienceBank] 工作经历保存成功');
    } catch (error) {
        console.error('Failed to save work experience:', error);
        // TODO: 显示错误提示
    }
};

// 取消修改
const handleCancelCard = (cardId: string) => {
    const original = originalCardData.get(cardId);
    if (original) {
        setCardData(new Map(cardData).set(cardId, JSON.parse(JSON.stringify(original))));
    }
    const newModified = new Set(modifiedCards);
    newModified.delete(cardId);
    setModifiedCards(newModified);
};

// 删除卡片
const handleDeleteCard = async (cardId: string) => {
    try {
        await experienceService.delete(cardId);

        // 刷新列表
        const updated = await experienceService.list('work');
        setWorkExperiences(updated);

        // 清理状态
        const newExpanded = new Set(expandedCards);
        newExpanded.delete(cardId);
        setExpandedCards(newExpanded);

        const newData = new Map(cardData);
        newData.delete(cardId);
        setCardData(newData);

        const newOriginal = new Map(originalCardData);
        newOriginal.delete(cardId);
        setOriginalCardData(newOriginal);

        setDeletingCardId(null);
        console.log('[ExperienceBank] 工作经历删除成功');
    } catch (error) {
        console.error('Failed to delete work experience:', error);
        // TODO: 显示错误提示
    }
};

// 新增工作经历
const handleAddNewWork = async () => {
    try {
        const newWork = await experienceService.create({
            category: 'work',
            version: {
                title: "新职位",
                org: "新公司",
                start_date: new Date().toISOString().split('T')[0],
                star: { s: "", t: "", a: "", r: "" }
            }
        });

        // 刷新列表
        const updated = await experienceService.list('work');
        setWorkExperiences(updated);

        // 自动展开新卡片
        toggleCard(newWork.master.id);
    } catch (error) {
        console.error('Failed to create work experience:', error);
        // TODO: 显示错误提示
    }
};

// AI润色卡片
const handlePolishCard = async (cardId: string) => {
    const data = cardData.get(cardId);
    if (!data) return;

    setIsPolishing(true);
    try {
        const response = await aiService.polishExperience({
            content: {
                company: data.org || "",
                role: data.title || "",
                s: data.star?.s || "",
                t: data.star?.t || "",
                a: data.star?.a || "",
                r: data.star?.r || "",
            },
        });

        // 更新卡片数据
        const newStar = { ...data.star };
        if (response.s) newStar.s = response.s;
        if (response.t) newStar.t = response.t;
        if (response.a) newStar.a = response.a;
        if (response.r) newStar.r = response.r;

        updateCardField(cardId, 'star', newStar);
    } catch (error) {
        console.error("Failed to polish experience", error);
    } finally {
        setIsPolishing(false);
    }
};
