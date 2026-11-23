// 화면을 그리다 오류가 나면 React가 화면 전체를 지워 흰 화면이 됨 → 그 대신 안내와 '다시 시도'
import { Component } from 'react';
import { ErrorState } from './Status.jsx';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[playpick] 화면 오류:', error?.message);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState
        title="화면을 보여 주지 못했어요"
        error={{ message: '잠시 문제가 생겼어요. 다시 시도하거나 다른 화면으로 이동해 주세요.' }}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
