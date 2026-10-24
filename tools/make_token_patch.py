import argparse
import pathlib


def main():
    parser = argparse.ArgumentParser(description='Create a one-line apply_patch update from a token replacement')
    parser.add_argument('target', type=pathlib.Path)
    parser.add_argument('token')
    parser.add_argument('replacement')
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    source = args.target.read_text(encoding='utf-8').splitlines()
    matches = [index for index, line in enumerate(source) if args.token in line]
    if len(matches) != 1:
        raise SystemExit(f'Expected one token match, found {len(matches)}')
    index = matches[0]
    old_line = source[index]
    new_line = old_line.replace(args.token, args.replacement, 1)
    patch = f'*** Begin Patch\n*** Update File: {args.target.as_posix()}\n@@\n-{old_line}\n+{new_line}\n*** End Patch\n'
    args.output.write_text(patch, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
