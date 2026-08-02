import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
  onBack: () => void;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PAD Studio route render failed', error, info);
  }

  render() {
    const {error} = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page-state is-error route-error-state" role="alert">
        <strong>Không thể hiển thị bước này</strong>
        <p>
          PAD Studio đã chặn lỗi hiển thị để dữ liệu dự án không bị ảnh
          hưởng. Hãy mở lại bước hoặc quay về bước trước để tiếp tục.
        </p>
        <div className="page-state-actions">
          <button type="button" onClick={this.props.onBack}>
            Về bước trước
          </button>
          <button type="button" onClick={this.props.onRetry}>
            Mở lại bước
          </button>
        </div>
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          <code>{error.message || error.name}</code>
        </details>
      </div>
    );
  }
}

