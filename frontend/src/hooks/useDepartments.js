import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../services/api';

export function useDepartments() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.listDepartments();
      setDepartments(data);
    } catch {
      // silent - callers handle the empty-state UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Active department names only - for user-creation / edit dropdowns.
  const departmentNames = departments
    .filter((d) => d.is_active)
    .map((d) => d.name);

  return { departments, departmentNames, loading, refetch };
}
