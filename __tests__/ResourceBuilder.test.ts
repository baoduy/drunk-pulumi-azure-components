import * as pulumi from '@pulumi/pulumi';
import { ResourceBuilder } from '../src';

pulumi.runtime.setMocks({
  newResource: (args) => ({
    id: args.name + '_id',
    state: args.inputs,
  }),
  call: (args) => args.inputs,
});

test('ResourceBuilder creates expected outputs', async () => {
  const builder = new ResourceBuilder('test', {
    /* args */
  });
  const outputs: any = await new Promise((resolve) => {
    pulumi.output(builder.getOutputs()).apply(resolve);
  });
  expect(outputs.rsGroup).toBeDefined();
  // Add more assertions as needed
});
