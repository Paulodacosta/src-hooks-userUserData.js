import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/config/supabaseClient';
import { getCurrentUser } from '@/config/auth';

const MAX_FREE_SCANS = 10;

export const useUserData = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUserProfile = useCallback(async (userId) => {
    setLoading(true);
    setError(null);
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError && profileError.code !== 'PGRST116') { 
        throw profileError;
      }
      
      if (profile) {
        const { data: mealLog, error: mealLogError } = await supabase
          .from('meal_logs')
          .select('*')
          .eq('user_id', userId)
          .order('scanned_at', { ascending: false });

        if (mealLogError) throw mealLogError;
        
        setUser({ ...profile, mealLog: mealLog || [] });
      } else {
         setUser(null); 
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError(err.message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initializeUser = async () => {
      const currentUser = await getCurrentUser();
      if (currentUser) {
        fetchUserProfile(currentUser.id);
      } else {
        setLoading(false);
      }
    };

    initializeUser();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        fetchUserProfile(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [fetchUserProfile]);

  const updateProfile = async (userId, updates) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      setUser(prevUser => ({ ...prevUser, ...data }));
      return data;
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err.message);
      return null;
    }
  };

  const incrementTrackCaloriesUsage = useCallback(async () => {
    if (!user || user.is_premium || user.credits > 0) return;
    if (user.track_calories_usage < MAX_FREE_SCANS) {
      await updateProfile(user.id, { track_calories_usage: user.track_calories_usage + 1 });
    }
  }, [user]);

  const addCredits = useCallback(async (amount) => {
    if (!user) return;
    await updateProfile(user.id, { credits: (user.credits || 0) + amount });
  }, [user]);

  const useCreditForScan = useCallback(async () => {
    if (!user || user.credits <= 0) return false;
    await updateProfile(user.id, { credits: user.credits - 1 });
    return true;
  }, [user]);

  const setPremium = useCallback(async (isPremiumStatus) => {
    if (!user) return;
    await updateProfile(user.id, { is_premium: isPremiumStatus });
  }, [user]);

  const addMealToLog = useCallback(async (mealItem) => {
    if (!user) return;
    try {
      const mealToAdd = { 
        ...mealItem, 
        user_id: user.id,
        scanned_at: new Date().toISOString()
      };
      delete mealToAdd.id; 

      const { data, error } = await supabase
        .from('meal_logs')
        .insert(mealToAdd)
        .select()
        .single();
      if (error) throw error;
      setUser(prevUser => ({
        ...prevUser,
        mealLog: [data, ...(prevUser.mealLog || [])]
      }));
      return data;
    } catch (err) {
      console.error('Error adding meal to log:', err);
      setError(err.message);
      return null;
    }
  }, [user]);
  
  const remainingFreeScans = user ? Math.max(0, MAX_FREE_SCANS - (user.track_calories_usage || 0)) : 0;
  const canUseForFree = user ? !user.is_premium && (user.credits || 0) === 0 && remainingFreeScans > 0 : false;
  const canUseWithCredits = user ? !user.is_premium && (user.credits || 0) > 0 : false;
  const canUseAsPremium = user ? user.is_premium : false;

  return {
    user,
    loading,
    error,
    fetchUserProfile,
    incrementTrackCaloriesUsage,
    addCredits,
    useCreditForScan,
    setPremium,
    addMealToLog,
    remainingFreeScans,
    canUseForFree,
    canUseWithCredits,
    canUseAsPremium,
    MAX_FREE_SCANS
  };
};