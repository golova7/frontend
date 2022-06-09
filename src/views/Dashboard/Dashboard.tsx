import React from 'react';
import { useWallet } from 'use-wallet';
import { createGlobalStyle } from 'styled-components';

import { Box, Grid, Button } from '@material-ui/core'

import UnlockWallet from '../../components/UnlockWallet';
import Page from '../../components/Page';
import FarmCard from './FarmCard';
import BoardroomCard from './BoardroomCard';
import HomeImage from '../../assets/img/background.jpg';

import useBanks from '../../hooks/useBanks';
import useBank from '../../hooks/useBank';
import useHarvestAll from '../../hooks/useHarvestAll';

const BackgroundImage = createGlobalStyle`
  body {
    //background: url(${HomeImage}) repeat !important;
    background-size: cover !important;
    background: radial-gradient(circle at 52.1% -29.6%, rgb(144, 17, 105) 0%, rgb(51, 0, 131) 100.2%);
  }
`;

const Dashboard = () => {
    const { account } = useWallet();
    const [banks] = useBanks();
    const vineyardPools = banks.filter((bank) => !bank.finished && bank.sectionInUI === 2);
    const nodePools = [useBank('GrapeNode'), useBank('LPNode'), useBank('WineNode')];
    const { onReward } = useHarvestAll(vineyardPools.concat(nodePools));
    return (
        <Page>
            <BackgroundImage />
            {!!account ? (
                <>
                    <h1 style={{ fontSize: '80px', textAlign: 'center' }}>Dashboard</h1>
                    <Box mt={3} display="flex" justifyContent="center">
                        <Button className='shinyButton' onClick={onReward}>Claim All</Button>
                    </Box>
                    <h1 style={{ fontSize: '60px', textAlign: 'center', marginTop: '50px' }}>Vineyard pools</h1>
                    <Box mt={3}>
                        <Grid container justifyContent="center" spacing={3}>
                            {vineyardPools
                                .map((bank) => (
                                    <React.Fragment key={bank.name}>
                                        <FarmCard bank={bank} />
                                    </React.Fragment>
                                ))}
                        </Grid>
                    </Box>
                    <h1 style={{ fontSize: '60px', textAlign: 'center', marginTop: '50px' }}>Grape nodes</h1>
                    <Box mt={3}>
                        <Grid container justifyContent="center" spacing={3}>
                            {nodePools
                                .map((bank) => (
                                    <React.Fragment key={bank.name}>
                                        <FarmCard bank={bank} />
                                    </React.Fragment>
                                ))}
                        </Grid>
                    </Box>
                    <h1 style={{ fontSize: '60px', textAlign: 'center', marginTop: '50px' }}>Winery pool</h1>
                    <Box mt={3}>
                        <Grid container justifyContent="center" spacing={3}>
                            <BoardroomCard />
                        </Grid>
                    </Box>
                </>
            ) : (
                <UnlockWallet />
            )}
        </Page>
    );
};

export default Dashboard;
