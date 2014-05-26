BIN = ./node_modules/.bin/
NODE ?= node

test:
	@$(BIN)mocha \
		--harmony-generators \
		--reporter spec \
		--bail

.PHONY: test
