import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('token quota modal guards zero quota progress', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const limit = Math\.max\(Number\(summary\?\.token_limit \?\? 0\), 0\);/);
  assert.match(modal, /const usedPercent = limit > 0\s+\? Math\.max\(0, Math\.min\(\(used \/ limit\) \* 100, 100\)\)\s+: 0;/);
});

test('token quota modal renders unlimited monthly plan state in gold', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const isUnlimitedQuota = Boolean\(summary\?\.is_unlimited\);/);
  assert.match(modal, /formatDateTime\(summary\?\.unlimited_expires_at\)/);
  assert.match(modal, /∞/);
  assert.match(modal, /bg-gradient-to-r from-amber-500 to-yellow-300/);
  assert.match(modal, /无限额度/);
  assert.match(modal, /到期时间/);
});

test('token quota modal hides redemption UI while keeping it connected to the service API', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const service = read('services/billingService.ts');

  assert.match(modal, /RedemptionCard/);
  assert.match(modal, /兑换卡密/);
  assert.match(modal, /const SHOW_REDEMPTION_CARD = false;/);
  assert.match(modal, /SHOW_REDEMPTION_CARD && \([\s\S]*<RedemptionCard/);
  assert.match(modal, /handleRedeem/);
  assert.match(modal, /isRedeeming/);
  assert.match(modal, /aria-label="卡密"\s+disabled=\{isRedeeming\}/);
  assert.match(modal, /onSummaryChange\(result\.summary\)/);
  assert.match(modal, /setRedemptionCode\(''\)/);
  assert.match(modal, /role="status" aria-live="polite"/);
  assert.match(modal, /redemptionError/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /clearRedemptionPresentation/);
  assert.match(modal, /const invalidateRedemptionRequest = React\.useCallback[\s\S]*redemptionRequestGenerationRef\.current \+= 1;[\s\S]*redemptionAbortControllerRef\.current\?\.abort\(\)/);
  const redemptionHandler = modal.match(/const handleRedeem = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(redemptionHandler, /billingService\.redeemCode\(code, \{ signal: controller\.signal \}\)/);
  assert.match(redemptionHandler, /const isCurrent = \(\) => \([\s\S]*paymentRefreshLifecycleGenerationRef\.current === lifecycleGeneration[\s\S]*redemptionRequestGenerationRef\.current === requestGeneration/);
  assert.ok((redemptionHandler.match(/if \(!isCurrent\(\)\) return;/g) ?? []).length >= 2);
  assert.match(redemptionHandler, /finally \{\s*if \(isCurrent\(\)\) \{[\s\S]*setIsRedeeming\(false\)/);
  assert.match(modal, /if \(!isOpen\) \{[\s\S]*invalidateRedemptionRequest\(\);[\s\S]*setIsRedeeming\(false\);/);
  assert.match(modal, /React\.useLayoutEffect\(\(\) => \{\s*if \(!isOpen\) \{\s*invalidatePaymentRefreshLifecycle\(\);\s*invalidateRedemptionRequest\(\);/);
  assert.match(service, /redeemCode/);
  assert.match(service, /\/api\/billing\/redemptions/);
  assert.match(service, /expectedAuthCacheKey: ownerKey/);
});

test('token quota modal presents permanent token packages as a bold unordered benefit list', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /Math\.floor\(tokenAmount \/ 17_000\)/);
  assert.match(modal, /Math\.floor\(tokenAmount \/ 5_000\)/);
  assert.match(modal, /: '永久有效';/);
  assert.match(modal, /<ul className="list-disc[^\"]*">/);
  assert.match(modal, /<strong className="font-extrabold[^\"]*">\{estimatedJdAnalyses\}<\/strong> 次 JD 分析/);
  assert.equal((modal.match(/\{estimatedAssistantActions\}<\/strong>/g) ?? []).length, 2);
  assert.doesNotMatch(modal, /实际消耗会随内容变化/);
  assert.doesNotMatch(modal, /\{formatTokens\(product\.token_amount\)\} Tokens/);
  assert.equal(Math.floor(100_000 / 17_000), 5);
  assert.equal(Math.floor(100_000 / 5_000), 20);
  assert.equal(Math.floor(500_000 / 17_000), 29);
  assert.equal(Math.floor(1_000_000 / 5_000), 200);
});

test('token quota modal renders server-owned packages and removes Taobao purchase links', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const service = read('services/billingService.ts');

  assert.match(modal, />\s*按量\s*<\/button>/);
  assert.match(modal, />\s*包月\s*<\/button>/);
  assert.match(modal, /选择套餐后将直接跳转支付/);
  assert.doesNotMatch(modal, /购买额度 \/ 兑换卡密/);
  assert.match(modal, /paymentsEnabled/);
  assert.match(modal, /activeProducts = products\.filter\(\(product\) => product\.category === activeTab\)/);
  assert.match(modal, /grid grid-cols-1 gap-2 sm:grid-cols-3/);
  assert.doesNotMatch(modal, /item\.taobao\.com/);
  assert.doesNotMatch(modal, /立即赞赏获取卡密/);
  assert.match(service, /getProducts/);
  assert.match(service, /createPaymentOrder/);
  assert.match(service, /getPaymentCheckout/);
});

test('token quota modal opens purchases as an accessible secondary page', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /type QuotaModalView = 'overview' \| 'purchase' \| 'orders'/);
  assert.match(modal, /onOpenPurchase=\{openPurchaseView\}/);
  assert.match(modal, /const openPurchaseView = \(\) => \{[\s\S]*if \(!purchaseContext\) void refreshPurchaseContext\(\);[\s\S]*if \(!catalogVersion\) void refreshProducts\(\);/);
  assert.match(modal, /aria-label=\{activeView === 'orders' \? '返回购买套餐' : '返回额度概览'\}/);
  assert.match(modal, /activeView === 'overview' \? \(/);
  assert.match(modal, /data-quota-view="overview"/);
  assert.match(modal, /data-quota-view="purchase"/);
  assert.match(modal, /data-quota-view="orders"/);
  assert.match(modal, /PaymentOrdersPanel/);
  assert.match(modal, /我的订单/);
  assert.match(modal, /role="tablist"/);
  assert.match(modal, /role="tab"/);
  assert.match(modal, /aria-selected=\{activeTab === 'tokens'\}/);
  assert.match(modal, /aria-selected=\{activeTab === 'unlimited'\}/);
  assert.equal((modal.match(/aria-controls="billing-plan-panel"/g) ?? []).length, 2);
  assert.match(modal, /id="billing-plan-panel"/);
  assert.match(modal, /role="tabpanel"/);
  assert.match(modal, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
  assert.match(modal, /initialView\?: QuotaModalView/);
  assert.match(modal, /initialView = 'overview'/);
  assert.match(modal, /returnFocusElement\?: HTMLElement \| null/);
  assert.match(modal, /dialogRef\.current\?\.focus\(\)/);
  assert.match(modal, /visibleAvatarButton/);
  assert.match(modal, /\[data-token-quota-focus-return\]/);
  assert.match(modal, /focusTarget\?\.isConnected && focusTarget\.offsetParent !== null/);
  assert.match(modal, /if \(initialView === 'purchase' \|\| returnedPaymentOrderId\) \{\s*setActiveView\('purchase'\);/);
  assert.match(modal, /if \(!isOpen\) \{\s*invalidatePaymentRefreshLifecycle\(\);\s*invalidateRedemptionRequest\(\);\s*setIsLoading\(false\);\s*setIsRedeeming\(false\);\s*clearCheckoutSubmitWatchdog\(\);\s*invalidateCheckoutRequest\(\);\s*invalidateOrderLoadRequests\(\);\s*invalidatePurchaseContextRequest\(\);/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="token-quota-dialog-title"/);
  assert.match(modal, /backButtonRef\.current\?\.focus\(\)/);
  assert.match(modal, /purchaseButtonRef\.current\?\.focus\(\)/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /if \(activeView === 'orders'\) \{\s*returnToPurchase\(\);\s*\} else if \(activeView === 'purchase'\) \{\s*returnToOverview\(\);/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /dialog\.querySelectorAll<HTMLElement>/);
  assert.doesNotMatch(modal, /收起兑换/);
  assert.doesNotMatch(modal, /isRedeemOpen/);
});

test('purchase context loads independently from order history', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.doesNotMatch(modal, /refreshPurchaseContext\?: boolean/);
  assert.doesNotMatch(modal, /options\?\.refreshPurchaseContext/);
  assert.match(modal, /const coordinatePaymentDataRefresh = React\.useCallback/);
  assert.match(modal, /paymentRefreshLifecycleGenerationRef\.current === lifecycleGeneration/);
  const synchronousUnmountGate = modal.match(/React\.useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[invalidatePaymentRefreshLifecycle, invalidateRedemptionRequest, isOpen\]\);/)?.[0] ?? '';
  assert.match(synchronousUnmountGate, /invalidatePaymentRefreshLifecycle\(\);/);
  assert.match(synchronousUnmountGate, /invalidateRedemptionRequest\(\);/);
  assert.doesNotMatch(synchronousUnmountGate, /set[A-Z][A-Za-z]+\(/);
  assert.match(modal, /React\.useEffect\(\(\) => \(\) => \{\s*clearCheckoutSubmitWatchdog\(\);\s*invalidateCheckoutRequest\(\);/);
  assert.ok(
    (modal.match(/coordinatePaymentDataRefresh\(\)/g) ?? []).length >= 3,
  );
});

test('token quota modal lists, refreshes, repeats, and cancels orders', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const ordersHook = read('components/usePaymentOrdersController.ts');
  const listLoader = read('components/paymentOrderListLoader.ts');
  const requestController = read('components/paymentOrderRequestController.ts');
  const service = read('services/billingService.ts');

  assert.match(
    ordersHook,
    /fetchPage: \(limit, cursor, signal\) => billingService\.listPaymentOrders\([\s\S]*limit,[\s\S]*cursor,[\s\S]*\{ signal \}/,
  );
  assert.match(modal, /加载更多/);
  assert.match(modal, /暂无订单/);
  assert.match(ordersHook, /订单加载失败，请稍后重试/);
  assert.match(modal, /继续支付/);
  assert.match(modal, /查询最终状态/);
  assert.match(modal, /确认取消/);
  assert.match(modal, /本地取消不会关闭支付平台上的旧收银台；“再次下单”会创建一笔新的同套餐订单。/);
  assert.match(modal, /const canRepeatPurchase = order\.status === 'cancelled' \|\| order\.status === 'expired';/);
  assert.match(modal, /const canQueryFinalStatus = order\.status === 'paid' \|\| canRepeatPurchase;/);
  assert.match(modal, /canRepeatPurchase && \([\s\S]*onClick=\{\(\) => onRepeatPurchase\(order\)\}[\s\S]*'再次下单'/);
  assert.doesNotMatch(modal, />继续原订单<\/button>/);
  const orderSummaryActions = modal.match(/<div className="flex shrink-0 items-center gap-2 self-start">[\s\S]*?paymentOrderStatusCopy\(order\.status\)[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(orderSummaryActions, /isPending && !isConfirming/);
  assert.match(orderSummaryActions, /onContinuePayment\(order\)/);
  assert.match(orderSummaryActions, /继续支付/);
  assert.match(orderSummaryActions, /onRepeatPurchase\(order\)/);
  assert.match(orderSummaryActions, /再次下单/);
  assert.match(modal, /canQueryFinalStatus && <button[^>]*onClick=\{\(\) => onSync\(order\)\}[^>]*>查询最终状态<\/button>/);
  assert.match(modal, /const canSelectNewPurchase = order\.status === 'failed';/);
  assert.match(modal, /重新选择套餐/);
  assert.match(modal, /case 'cancelled': return '已取消'/);
  assert.match(modal, /case 'expired': return '已取消（超时）'/);
  assert.match(modal, /case 'expired': return '订单已过期；如仍需购买，请再次下单。';/);
  assert.match(modal, /isOrderPastDue/);
  assert.match(modal, /usePaymentOrdersController\(clearPurchaseAttemptForTerminalOrder\)/);
  assert.doesNotMatch(modal, /ordersRequestGenerationRef|ordersLoadRequestRef|orderActionInFlightRef/);
  assert.match(requestController, /private ordersRequestGeneration = 0/);
  assert.match(requestController, /private orderActionInFlight = false/);
  assert.match(requestController, /this\.ordersAbortControllers\.forEach\(\(controller\) => controller\.abort\(\)\)/);
  assert.match(requestController, /if \(this\.orderActionInFlight\) return null/);
  assert.match(requestController, /this\.invalidateLoads\(\)/);
  assert.match(ordersHook, /const invalidateOrderLoadRequests = React\.useCallback/);
  assert.match(ordersHook, /controller\.invalidateLoads\(\);\s*setIsLoadingOrders\(false\);\s*setIsLoadingMoreOrders\(false\);/);
  assert.match(listLoader, /controller\.beginLoad\(\{[\s\S]*replayLoadedDepth: Boolean\(options\?\.replayLoadedDepth\)/);
  assert.match(listLoader, /while \(\s*!append\s*&& loadedPages < request\.replayPageDepth/);
  assert.match(listLoader, /if \(!controller\.isLoadCurrent\(request\)\) return false;/);
  assert.match(listLoader, /onFinish\(controller\.finishLoad\(request\)\)/);
  assert.match(modal, /loadOrders\(\{ replayLoadedDepth: true \}\)/);
  assert.match(modal, /if \(!isOpen \|\| activeView !== 'orders' \|\| checkoutReturnSyncOrderId\) return;/);
  assert.match(modal, /window\.clearInterval\(timer\);\s*invalidateOrderLoadRequests\(\);/);
  assert.match(modal, /invalidateOrderAction\(\);[\s\S]*setCheckoutForm\(null\)/);
  assert.match(ordersHook, /const finishOrderAction = React\.useCallback/);
  assert.match(requestController, /this\.orderActionAbortController\?\.abort\(\)/);
  assert.ok((modal.match(/finishOrderAction\(actionRequest\)/g) ?? []).length >= 3);
  assert.ok((modal.match(/isOrderActionCurrent\(actionRequest\)/g) ?? []).length >= 6);
  assert.ok((modal.match(/signal: actionRequest\.abortController\.signal/g) ?? []).length >= 2);
  assert.match(modal, /const isBusy = actionOrderId !== null;/);
  assert.match(modal, /const isCurrentAction = actionOrderId === order\.id;/);
  assert.match(modal, /const isPastDue = isOrderPastDue\(order, now\)/);
  assert.match(modal, /isPending && !isConfirming/);
  assert.doesNotMatch(modal, /if \(isOrderPastDue\(order, Date\.now\(\)\)\)/);
  assert.match(modal, /confirmButtonRef\.current\?\.focus\(\)/);
  assert.match(modal, /cancelTriggerRefs\.current\.get\(orderId\) \?\? orderArticleRefs\.current\.get\(orderId\)/);
  assert.match(modal, /restoreCancelFocusRef\.current = confirmingOrderId/);
  assert.match(modal, /window\.setInterval/);
  assert.match(service, /listPaymentOrders/);
  assert.match(service, /cancelPaymentOrder/);
  assert.match(service, /PaymentOrderListResponse/);
});

test('payment checkout submits the signed server form and returned orders sync safely', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const orderUtils = read('components/tokenQuotaOrderUtils.ts');
  const submissionController = read('components/paymentCheckoutSubmissionController.ts');
  const app = read('App.tsx');

  assert.match(modal, /crypto\.randomUUID/);
  assert.match(modal, /getOrCreatePurchaseIdempotencyKey/);
  assert.match(modal, /clearMatchingTerminalPurchaseAttempt/);
  assert.match(modal, /purchaseIdempotencyKeysRef/);
  assert.match(modal, /purchaseOrderIdsRef/);
  const nativeSubmitEffect = modal.match(/React\.useEffect\(\(\) => \{\s*if \(!isOpen \|\| activeView !== 'purchase'[\s\S]*?\}, \[activeView, armCheckoutSubmitWatchdog/)?.[0] ?? '';
  assert.doesNotMatch(nativeSubmitEffect, /purchaseIdempotencyKeysRef\.current\.delete/);
  assert.doesNotMatch(nativeSubmitEffect, /purchaseOrderIdsRef\.current\.delete/);
  assert.doesNotMatch(modal, /purchaseInFlightRef/);
  assert.match(modal, /checkoutRequestGenerationRef/);
  assert.match(modal, /checkoutInFlightGenerationRef/);
  assert.match(modal, /beginCheckoutRequest/);
  assert.match(modal, /isCheckoutRequestCurrent/);
  assert.match(modal, /finishCheckoutRequest/);
  assert.match(modal, /invalidateCheckoutRequest/);
  const checkoutInvalidator = modal.match(
    /const invalidateCheckoutRequest = React\.useCallback\(\(\) => \{[\s\S]*?\}, \[invalidateOrderAction\]\);/,
  )?.[0] ?? '';
  assert.match(checkoutInvalidator, /checkoutSubmissionControllerRef\.current\.invalidate\(\)/);
  assert.match(checkoutInvalidator, /setIsCheckoutSubmitting\(false\)/);
  assert.match(modal, /checkoutAbortControllerRef\.current\?\.abort\(\);[\s\S]*checkoutRequestGenerationRef\.current \+= 1;/);
  assert.match(modal, /const handleClose = \(\) => \{[\s\S]*if \(isCheckoutSubmitting\) return;\s*invalidatePaymentRefreshLifecycle\(\);\s*invalidateRedemptionRequest\(\);\s*setIsRedeeming\(false\);\s*invalidateCheckoutRequest\(\);/);
  assert.match(modal, /setCheckoutForm\(null\)/);
  assert.match(modal, /const checkoutSubmitWatchdogRef = React\.useRef<number \| null>\(null\)/);
  assert.match(modal, /const clearCheckoutSubmitWatchdog = React\.useCallback/);
  assert.match(modal, /const recoverCheckoutSubmission = React\.useCallback/);
  assert.match(modal, /const armCheckoutSubmitWatchdog = React\.useCallback/);
  const checkoutRecovery = modal.match(
    /const recoverCheckoutSubmission = React\.useCallback\([\s\S]*?\}, \[clearCheckoutSubmitWatchdog, rememberOrderForCheckoutRecovery\]\);/,
  )?.[0] ?? '';
  const checkoutWatchdog = modal.match(
    /const armCheckoutSubmitWatchdog = React\.useCallback\([\s\S]*?\}, \[clearCheckoutSubmitWatchdog, recoverCheckoutSubmission\]\);/,
  )?.[0] ?? '';
  assert.match(checkoutRecovery, /setActiveView\('orders'\)/);
  assert.match(checkoutWatchdog, /recoverCheckoutSubmission\(order\)/);
  assert.doesNotMatch(checkoutRecovery, /checkoutSubmissionControllerRef\.current\.invalidate\(\)/);
  assert.doesNotMatch(checkoutWatchdog, /checkoutSubmissionControllerRef\.current\.invalidate\(\)/);
  assert.match(modal, /\}, 10_000\);/);
  assert.match(modal, /form\.submit\(\);\s*armCheckoutSubmitWatchdog\(order, submission\);/);
  assert.match(modal, /const handlePageHide = \(\) => \{\s*checkoutSubmissionControllerRef\.current\.markPageHidden\(\);\s*clearCheckoutSubmitWatchdog\(\);/);
  assert.match(modal, /window\.addEventListener\('pagehide', handlePageHide\)/);
  assert.match(modal, /未能跳转至收银台，订单已保留。请在订单列表点击“继续支付”。/);
  assert.match(modal, /setIsCheckoutSubmitting\(true\)/);
  assert.match(modal, /checkoutSubmissionControllerRef\.current\.beginSubmission\(order\.id\)/);
  assert.match(modal, /const handlePageShow = \(event: PageTransitionEvent\) => \{\s*if \(!event\.persisted\) return;/);
  assert.match(modal, /checkoutSubmissionControllerRef\.current\.consumePersistedPageShow\(\)/);
  assert.match(modal, /resetCheckoutAfterExternalReturn\(\);/);
  assert.match(modal, /setCheckoutReturnSyncOrderId\(orderId\);/);
  assert.match(modal, /billingService\.syncPaymentOrder\(orderId\)/);
  assert.match(modal, /invalidateOrderLoadRequests\(\);\s*setActiveView\('orders'\);/);
  assert.equal((modal.match(/setIsCheckoutSubmitting\(true\);\s*setCheckoutForm\(checkout\);/g) ?? []).length, 2);
  assert.match(modal, /isPurchasing \|\| isCheckoutSubmitting/);
  assert.match(modal, /订单已创建，但暂时无法打开收银台。请稍后点击“继续支付”。/);
  assert.match(modal, /resolveUnsettledPaymentOrderConflict\(purchaseError\)/);
  assert.match(modal, /paymentOrderCreationRateLimitMessage\(purchaseError\)[\s\S]*setError\(rateLimitMessage\)/);
  assert.match(modal, /paymentOrderConflictMessage\(unsettledConflict\)/);
  assert.match(modal, /const handleContinuePayment = async \(order: PaymentOrder\) => \{\s*if \(isCheckoutSubmitting\) return;/);
  assert.match(modal, /Failed to resume payment order[\s\S]*resolveUnsettledPaymentOrderConflict\(checkoutError\)/);
  assert.match(modal, /billingService\.getPaymentOrder\(unsettledConflict\.orderId\)/);
  assert.match(modal, /billingService\.getPaymentOrder\(unsettledConflict\.orderId\)/);
  assert.match(modal, /console\.warn\('Failed to load checkout for created payment order', checkoutError\)/);
  assert.match(modal, /resolveUnsettledPaymentOrderConflict\(checkoutError\)/);
  assert.match(modal, /const handleRepeatPurchase = async \(order: PaymentOrder\) => \{[\s\S]*if \(!paymentsEnabled\)[\s\S]*products\.find\(\(candidate\) => candidate\.sku === order\.sku\)[\s\S]*clearPurchaseAttemptForTerminalOrder\(order\);[\s\S]*setActiveView\('purchase'\);\s*await handlePurchase\(product\);/);
  assert.match(modal, /activeView !== 'purchase'/);
  assert.match(modal, /isPurchasing \|\| isCheckoutSubmitting \|\| !paymentsEnabled/);
  assert.match(modal, /disabled=\{isPurchasing \|\| isCheckoutSubmitting \|\| !isPurchaseContextReady\}/);
  assert.match(modal, /role="alert" aria-live="assertive"/);
  assert.match(modal, /action=\{checkoutForm\.action\}/);
  assert.match(modal, /Object\.entries\(checkoutForm\.fields\)/);
  assert.match(modal, /syncPaymentOrder\(returnedPaymentOrderId\)/);
  assert.match(modal, /finishReturnedOrder\(order, true\)/);
  assert.match(submissionController, /shouldRecoverFromWatchdog/);
  assert.match(submissionController, /consumePersistedPageShow/);
  assert.doesNotMatch(modal, /submittedCheckoutOrderIdRef|checkoutPageHideRef/);
  assert.match(modal, /if \(consumeReturnedOrder && order\.id === returnedPaymentOrderId\)/);
  const fulfilledHandler = modal.match(/const finishReturnedOrder = React\.useCallback\([\s\S]*?\}, \[onPaymentOrderHandled, refreshFulfilledOrderData, returnedPaymentOrderId\]\);/)?.[0] ?? '';
  assert.ok(fulfilledHandler.indexOf('onPaymentOrderHandled?.()') < fulfilledHandler.indexOf('refreshFulfilledOrderData(order, consumeReturnedOrder)'));
  assert.doesNotMatch(fulfilledHandler, /await refresh/);
  assert.match(modal, /rememberOrderForCheckoutRecovery\(order\);\s*if \(await finishReturnedOrder\(order, true\)\) \{\s*void refreshPurchaseContext\(\);\s*return;\s*\}\s*await refreshPurchaseContext\(\);/);
  const quotaRefreshInvalidator = modal.match(/const invalidateQuotaRefresh = React\.useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? '';
  assert.match(quotaRefreshInvalidator, /quotaRefreshGenerationRef\.current \+= 1;[\s\S]*quotaRefreshAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(quotaRefreshInvalidator, /fulfilledRefreshGenerationRef\.current \+= 1;[\s\S]*fulfilledRefreshAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(quotaRefreshInvalidator, /billingService\.clearBillingCache\(\)/);
  const regularQuotaRefresh = modal.match(/const refresh = React\.useCallback\(async[\s\S]*?\}, \[invalidateQuotaRefresh, onSummaryChange\]\);/)?.[0] ?? '';
  assert.match(regularQuotaRefresh, /invalidateQuotaRefresh\(\);[\s\S]*const refreshGeneration = quotaRefreshGenerationRef\.current/);
  assert.match(regularQuotaRefresh, /billingService\.getSummary\(\{ force: true, signal: controller\.signal \}\)/);
  assert.match(regularQuotaRefresh, /billingService\.getUsage\(80, \{ signal: controller\.signal \}\)/);
  assert.match(regularQuotaRefresh, /controller\.signal\.aborted[\s\S]*quotaRefreshGenerationRef\.current !== refreshGeneration[\s\S]*onSummaryChange\(nextSummary\)/);
  assert.match(modal, /const refreshFulfilledOrderData = React\.useCallback[\s\S]*?invalidateQuotaRefresh\(\);\s*setIsLoading\(false\);[\s\S]*?const refreshGeneration = fulfilledRefreshGenerationRef\.current;/);
  assert.match(modal, /Promise\.allSettled\(\[[\s\S]*billingService\.getUsage\(80, \{ signal: controller\.signal \}\)/);
  assert.match(modal, /Payment fulfilled but post-payment refresh failed/);
  assert.match(modal, /attempts < 6/);
  assert.match(modal, /重新查询支付状态/);
  assert.match(modal, /setPaymentSyncRetryRequest\(\(request\) => request \+ 1\)/);
  assert.match(modal, /const observedPaymentStateToken = purchaseContext\?\.payment_state_token;/);
  assert.match(modal, /const observedCatalogVersion = catalogVersion;/);
  assert.match(modal, /requiresRepeatPurchaseAcknowledgement\(/);
  assert.match(modal, /acknowledgedPaymentStateTokenRef\.current = observedPaymentStateToken/);
  assert.match(modal, /最近订单已支付或到账；如确需再次购买，请再次点击购买/);
  assert.match(modal, /createPaymentOrder\(\s*product\.sku,\s*idempotencyKey,\s*observedPaymentStateToken,\s*observedCatalogVersion,/);
  assert.match(modal, /getPaymentPurchaseContext\(\{ signal: controller\.signal \}\)/);
  assert.match(orderUtils, /payment_order_state_changed/);
  assert.match(orderUtils, /payment_catalog_changed/);
  assert.match(modal, /unsettledConflict\.code === 'payment_catalog_changed'/);
  assert.match(modal, /payment_catalog_changed'[\s\S]*purchaseIdempotencyKeysRef\.current\.delete\(product\.sku\)/);
  assert.match(modal, /payment_order_state_changed'[\s\S]*purchaseIdempotencyKeysRef\.current\.delete\(product\.sku\)/);
  assert.match(modal, /Promise\.all\(\[refreshProducts\(\), refreshPurchaseContext\(\)\]\)/);
  assert.match(orderUtils, /套餐价格\/权益已更新，请确认后再次点击购买/);
  assert.match(orderUtils, /请确认后再次点击购买/);
  assert.match(modal, /loadOrders\(\{ replayLoadedDepth: true \}\)/);
  assert.match(modal, /role="alert" aria-live="assertive" className="rounded-lg bg-red-50/);
  assert.match(modal, /'creating' \| 'processing'/);
  assert.match(app, /payment_order/);
  assert.match(app, /'sign_type'/);
  assert.match(app, /setIsTokenQuotaOpen\(true\)/);
  assert.match(app, /history\.replaceState/);
});

test('usage trend chart fills its card height and reserves space for date labels', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const axisMax = maxVal > 0 \? maxVal \* 1\.25 : 1000;/);
  assert.match(modal, /const labelBandHeight = usageByDay\.length >= 2 \? 18 : 0;/);
  assert.match(modal, /const chartBottom = height - labelBandHeight - 1;/);
  assert.match(modal, /item\.total_tokens \/ axisMax/);
  assert.match(modal, /<svg viewBox=\{`0 0 \$\{width\} \$\{height\}`\} className="h-full w-full overflow-visible"/);
});

test('token quota modal uses supported Tailwind CDN utilities', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const unsupportedUtilityClasses = [
    'border-gray-150',
    'text-gray-650',
    'dark:text-emerald-450',
    'dark:bg-gray-850',
    'dark:border-gray-850',
    'text-emerald-650',
    'dark:text-emerald-350',
    'h-4.5',
    'w-4.5',
    'h-8.5',
    'w-8.5',
    'py-0.2',
    'text-red-650',
    'scrollbar-thin',
    'scrollbar-thumb-gray-250',
  ];

  for (const utilityClass of unsupportedUtilityClasses) {
    const pattern = new RegExp(`\\b${utilityClass.replaceAll('.', '\\.')}\\b`);
    assert.doesNotMatch(modal, pattern, `${utilityClass} should not be used in TokenQuotaModal`);
  }
});
