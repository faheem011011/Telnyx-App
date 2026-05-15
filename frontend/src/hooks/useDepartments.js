import { useState, useEffect } from 'react';
import { adminApi } from '../services/api';

let _cache = null;
let _pending = null;

export function useDepartments() {
  const [departments, setDepartments] = useState(_cache || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) return;
    if (!_pending) {
      _pending = adminApi.listDepartments();
    }
    let cancelled = false;
    _pending
      .then((data) => {
        if (!cancelled) {
          _cache = data;
          setDepartments(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { departments, loading };
}
