export const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'loading' | 'info' = 'info') => {
  console.log(`[Toast ${type}]: ${message}`);
  // In a real app, you might want to dispatch a UI event or usage the Snackbar component
};
