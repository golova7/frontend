import { BigNumber } from 'ethers';
import { useCallback, useState, useEffect } from 'react';
import useGrapeFinance from './useGrapeFinance';
import config from '../config';

const useGrapeMimSWTotalNode = () => {
  const grapeFinance = useGrapeFinance();

  const [poolAPRs, setPoolAPRs] = useState<BigNumber[]>([]);

  const fetchNodes = useCallback(async () => {
    setPoolAPRs(await grapeFinance.getGrapeMimSWNodes());
  }, [grapeFinance]);

  useEffect(() => {
    
      fetchNodes().catch((err) => console.error(`Failed to fetch APR info: ${err.stack}`));
      const refreshInterval = setInterval(fetchNodes, config.refreshInterval);
      return () => clearInterval(refreshInterval);
    
  }, [setPoolAPRs, grapeFinance, fetchNodes]);

  return poolAPRs;
};

export default useGrapeMimSWTotalNode;