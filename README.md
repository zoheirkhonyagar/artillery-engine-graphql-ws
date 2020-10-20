# artillery-engine-graphql-ws

### installation
#### artillery
`npm install -g artillery`

#### engine
`npm install -g artillery-engine-graphql-ws`

### after install make sure to add `graphql-ws` as engine to your `.yml` file like this example:
```
# simple-socketio-load-test.yaml
config:
  target: 'ws://localhost:4001/graphql'
  phases:
    - duration: 20 # Test for 60 seconds
      arrivalRate: 10 # Every second, add 10 users
      rampTo: 10 # And ramp it up to 100 users in total over the 60s period
      name: 'Ramping up the load'
    - duration: 30 # Then resume the load test for 120s
      arrivalRate: 10 # With those 100 users we ramped up to in the first phase
      rampTo: 10 # And keep it steady at 100 users
      name: 'Pushing a constant load'
  engines:
    'graphql-ws': {}
scenarios:
  - name: 'load testing subscription'
    engine: graphql-ws
    flow:
      - send:
          {
            'id': '1',
            'type': 'start',
            'payload':
              {
                'variables':
                  { 'input': { 'symbol': 'example', 'timeFrame': 'example' } },
                'extensions': {},
                'operationName': 'getRealExample',
                'query': "subscription getRealExample($input: getRealExampleInput!) {\n  getRealExample(input: $input) {\n    Close\n    close\n    data\n    name\n    __typename\n  }\n}\n",
              },
          }
      - think: 15 # Every connection will remain open for 15s
      - send: { 'id': '1', 'type': 'end' }
```