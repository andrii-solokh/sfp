import { Messages } from '@salesforce/core';
import SfpCommand from '../../SfpCommand';
import { Stage } from '../../impl/Stage';
import SFPLogger, { COLOR_KEY_MESSAGE, ConsoleLogger } from '@flxbl-io/sfp-logger';
import { Flags } from '@oclif/core';
import { loglevel } from '../../flags/sfdxflags';
import ImpactedPackageResolver, { ImpactedPackageProps } from '../../impl/impact/ImpactedPackagesResolver';
import path from 'path';
import * as fs from 'fs-extra';
import ImpactedPackagesDisplayer from '../../core/display/ImpactedPackagesDisplayer';
import { LoggerLevel } from '@flxbl-io/sfp-logger';


Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@andrii-solokh/sfp', 'impact_package');

export default class Package extends SfpCommand {
    public static flags = {
        loglevel,
        basebranch: Flags.string({
            description: messages.getMessage('baseCommitOrBranchFlagDescription'),
            required: true,
        })
    };

    public static description = messages.getMessage('commandDescription');
    private props: ImpactedPackageProps;

    async execute(): Promise<any> {
        // Read Manifest

        this.props = {
            currentStage: Stage.BUILD,
            baseBranch: this.flags.basebranch,
            diffOptions: {
                useLatestGitTags: true,
                skipPackageDescriptorChange: false,
            },
        };

        const impactedPackageResolver = new ImpactedPackageResolver(this.props, new ConsoleLogger());

        let packagesToBeBuiltWithReasons = await impactedPackageResolver.getImpactedPackages();
        const packagesToBeBuilt = Array.from(packagesToBeBuiltWithReasons.keys());
        SFPLogger.log(COLOR_KEY_MESSAGE('Packages impacted...'),LoggerLevel.INFO,new ConsoleLogger());  
        ImpactedPackagesDisplayer.displayImpactedPackages(packagesToBeBuiltWithReasons, new ConsoleLogger());
       
        
        const outputPath = path.join(process.cwd(), 'impacted-package.json');
        if (packagesToBeBuilt && packagesToBeBuilt.length > 0)
            fs.writeFileSync(outputPath, JSON.stringify(packagesToBeBuilt, null, 2));
        else fs.writeFileSync(outputPath, JSON.stringify([], null, 2));
        SFPLogger.log(`Impacted packages if any written to ${outputPath}`);


       return packagesToBeBuilt;
    }



 
}
