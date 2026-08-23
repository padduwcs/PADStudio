import {useEffect, useRef} from 'react';
import {registerNavigationGuard} from './router.ts';

/**
 * Keeps a client-orchestrated workflow operation on its owning page until it
 * settles. Several production actions span multiple revision-guarded HTTP
 * requests; unmounting between them would leave a valid but partial result.
 */
export function useWorkflowOperationGuard(active: boolean, message: string) {
  const allowNextNavigationRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    return registerNavigationGuard(() => {
      if (allowNextNavigationRef.current) {
        allowNextNavigationRef.current = false;
        return true;
      }
      window.alert(message);
      return false;
    });
  }, [active, message]);

  useEffect(() => {
    if (!active) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [active]);

  return () => {
    allowNextNavigationRef.current = true;
  };
}
