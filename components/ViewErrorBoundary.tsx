import React from 'react';

interface ViewErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
  viewName?: string;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

const DEFAULT_ERROR_MESSAGE = '页面渲染失败，请刷新或返回上一页重试。';

class ViewErrorBoundary extends React.Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = {
    hasError: false,
    errorMessage: DEFAULT_ERROR_MESSAGE,
  };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || DEFAULT_ERROR_MESSAGE,
    };
  }

  componentDidCatch(error: Error) {
    const viewName = this.props.viewName ? ` (${this.props.viewName})` : '';
    console.error(`[ViewErrorBoundary] Render failed${viewName}:`, error);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      errorMessage: DEFAULT_ERROR_MESSAGE,
    });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex-1 flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">页面渲染出错</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{this.state.errorMessage}</p>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
          >
            返回仪表盘
          </button>
        </div>
      </div>
    );
  }
}

export default ViewErrorBoundary;
