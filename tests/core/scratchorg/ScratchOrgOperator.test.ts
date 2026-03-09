import { Duration } from '@salesforce/kit';
import { expect } from '@jest/globals';
import ScratchOrgOperator from '../../../src/core/scratchorg/ScratchOrgOperator';

describe('ScratchOrgOperator', () => {
    const scratchCreateResponse = {
        username: 'test@example.com',
        scratchOrgInfo: { LoginUrl: 'https://test.example.com' },
        authFields: { orgId: '00D000000000001' },
        warnings: [],
    };

    function createOperator() {
        const hubOrg = {
            scratchOrgCreate: jest.fn().mockResolvedValue(scratchCreateResponse),
        };
        const operator: any = new ScratchOrgOperator(hubOrg as any);
        operator.setAliasForUsername = jest.fn().mockResolvedValue(undefined);
        return { operator, hubOrg };
    }

    it('uses nonamespace=false by default when noNamespace is not set', async () => {
        const { operator, hubOrg } = createOperator();

        await operator.requestAScratchOrg('test-alias', 'config/project-scratch-def.json', Duration.days(1), Duration.minutes(1), {});

        expect(hubOrg.scratchOrgCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                nonamespace: false,
            })
        );
    });

    it('uses nonamespace=true when noNamespace is enabled in pool config', async () => {
        const { operator, hubOrg } = createOperator();

        await operator.requestAScratchOrg('test-alias', 'config/project-scratch-def.json', Duration.days(1), Duration.minutes(1), {
            noNamespace: true,
        });

        expect(hubOrg.scratchOrgCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                nonamespace: true,
            })
        );
    });
});
